const express = require('express')
const querystring = require('querystring')
const parseAlgoliaSQL = require('./src/parseAlgoliaSQL')
const { getIndex, existIndex, resetIndex } = require('./src/indexes')

const { v4 } = require('uuid')

const createServer = (options) => {
  const path = options.path || process.cwd()
  const app = express()

  app.use(express.json({ type: '*/*' }))

  app.post('/1/indexes/:indexName/query', async (req, res) => {
    const {
      body,
      params: { indexName }
    } = req
    const { params: queryParams } = body

    const db = getIndex(indexName, path)

    const { query, filters, facetFilters } = queryParams
      ? querystring.parse(queryParams)
      : body

    const searchExp = []
    if (query !== undefined) {
      searchExp.push(!query ? '*' : query)
    }

    if (filters) {
      searchExp.push(parseAlgoliaSQL(db, filters))
    }

    if (facetFilters) {
      searchExp.push(
        parseAlgoliaSQL(
          db,
          facetFilters
            .map((f) => (Array.isArray(f) ? `(${f.join(' OR ')})` : f))
            .join(' AND ')
        )
      )
    }

    const result = await db.SEARCH(...searchExp)

    const hits = result.map((item) => {
      const { obj } = item
      obj.objectID = obj._id
      delete obj._id
      return obj
    })

    return res.json({
      hits,
      params: queryParams || '',
      query: query || ''
    })
  })

  app.post('/1/indexes/:indexName', async (req, res) => {
    const {
      body,
      params: { indexName }
    } = req
    const _id = v4()

    const db = getIndex(indexName, path)
    await db.PUT([
      {
        _id,
        ...body
      }
    ])

    return res.status(201).json({
      createdAt: new Date().toISOString(),
      taskID: 'algolite-task-id',
      objectID: _id
    })
  })

  app.post('/1/indexes/:indexName/batch', async (req, res) => {
    const {
      body,
      params: { indexName }
    } = req
    const puts = []
    const deletes = []

    for (const request of body.requests) {
      switch (request.action) {
        case 'updateObject':
          request.body._id = request.body.objectID
          delete request.body.objectID
          puts.push(request.body)
          break

        case 'deleteObject':
          deletes.push(request.body.objectID)
          break

        default:
          // not supported
          return res.status(400).end()
      }
    }

    const db = getIndex(indexName, path)
    if (puts.length) {
      await db.PUT(puts)
    }
    if (deletes.length) {
      await db.DELETE(deletes)
    }

    return res.status(201).json({
      taskID: 'algolite-task-id',
      objectIDs: body.requests.map((r) => r.body.objectID)
    })
  })

  app.put('/1/indexes/:indexName/:objectID', async (req, res) => {
    const {
      body,
      params: { indexName }
    } = req
    const { objectID } = req.params

    const db = getIndex(indexName, path)
    try {
      await db.DELETE([objectID])
    } catch (error) {
      if (!error.notFound) {
        return res.status(500).end()
      }
    }

    await db.PUT([
      {
        _id: objectID,
        ...body
      }
    ])

    return res.status(201).json({
      updatedAt: new Date().toISOString(),
      taskID: 'algolite-task-id',
      objectID
    })
  })

  app.delete('/1/indexes/:indexName/:objectID', async (req, res) => {
    const { objectID, indexName } = req.params

    const db = getIndex(indexName, path)
    try {
      await db.DELETE([objectID])
    } catch (error) {
      if (!error.notFound) {
        res.status(500).end()
      }
    }

    return res.status(200).json({
      deletedAt: new Date().toISOString(),
      taskID: 'algolite-task-id',
      objectID
    })
  })

  app.post('/1/indexes/:indexName/deleteByQuery', async (req, res) => {
    const {
      body,
      params: { indexName }
    } = req
    const { params: queryParams } = body

    const { facetFilters } = querystring.parse(queryParams)

    const db = getIndex(indexName, path)

    const searchExp = []
    if (facetFilters) {
      searchExp.push(parseAlgoliaSQL(db, facetFilters))
    }

    if (searchExp.length === 0) {
      return res.status(400).json({
        message:
          'DeleteByQuery endpoint only supports tagFilters, facetFilters, numericFilters and geoQuery condition',
        status: 400
      })
    }

    const result = await db.SEARCH(...searchExp)
    const ids = result.map((obj) => obj._id)
    await db.INDEX.DELETE(ids)

    return res.status(201).json({
      updatedAt: new Date().toISOString(),
      taskID: 'algolite-task-id'
    })
  })

  app.post('/1/indexes/:indexName/clear', async (req, res) => {
    const { indexName } = req.params

    if (!existIndex(indexName, path)) {
      return res.status(400).end()
    }

    const db = getIndex(indexName, path)
    const result = await db.INDEX.GET('')
    const ids = result.map((obj) => obj._id)
    await db.DELETE(ids)
    resetIndex(indexName)

    return res.status(200).json({
      taskID: 'algolite-task-id'
    })
  })

  app.post('/1/indexes/:indexName/browse', async (req, res) => {
    const start = Date.now()
    const {
      body,
      params: { indexName }
    } = req
    if (!existIndex(indexName, path)) {
      return res.status(400).end()
    }
    const { cursor, attributesToRetrieve = [] } = body
    const attributeMap = attributesToRetrieve.reduce((acc, attr) => {
      acc[attr] = true
      return acc
    }, {})

    const db = getIndex(indexName, path)
    const pageSize = 1000
    const parsedCursor = cursor ? parseInt(cursor, 10) : 0
    const page = Math.floor(parsedCursor / pageSize)
    // get ALL the data from the index then slice it as needed
    const indexes = await db.INDEX.GET('')
    const indexesToReturn = indexes.slice(parsedCursor, parsedCursor + pageSize)
    const hits = (await db.INDEX.OBJECT(indexesToReturn)).map((item) => {
      const result = {
        ...item['!doc']
      }
      if (attributesToRetrieve.length) {
        Object.keys(result).forEach((key) => {
          if (!attributeMap[key]) {
            delete result[key]
          }
        })
      }
      result.objectID = item._id
      delete result._id
      return result
    })
    const end = parsedCursor + pageSize
    return res.status(200).json({
      hits,
      page,
      nbHits: indexes.length,
      nbPages: Math.ceil(hits.length / pageSize),
      hitsPerPage: pageSize,
      processingTimeMS: Date.now() - start,
      query: '', // TODO: add query
      params: '', // TODO: add params
      cursor: end >= indexes.length ? undefined : String(end)
    })
  })

  // https://www.algolia.com/doc/rest-api/search/#get-object
  app.get('/1/indexes/:indexName/:objectId', async (req, res) => {
    const { indexName } = req.params

    if (!existIndex(indexName, path)) {
      return res.status(404).end()
    }
    const db = getIndex(indexName, path)
    try {
      const result = await db.INDEX.OBJECT([{ _id: req.params.objectId }])
      const obj = {
        ...result[0]['!doc']
      }
      obj.objectID = result[0]._id
      delete obj._id
      return res.status(200).json(obj)
    } catch (e) {
      return res.status(404).end()
    }
  })

  return app
}

module.exports = createServer
