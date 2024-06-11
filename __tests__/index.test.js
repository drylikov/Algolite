const fs = require('fs')
const os = require('os')
const { join } = require('path')
const createServer = require('../index')
const algoliasearch = require('algoliasearch')

describe('the algolite implementation', () => {
  const port = 3331
  let algoliaServer
  const path = join(os.tmpdir(), 'algolia-mock-2')
  const ag = algoliasearch('appId', 'apiKey', {
    hosts: [
      {
        protocol: 'http',
        url: `localhost:${port}`
      }
    ]
  })
  const index = ag.initIndex('test')

  beforeAll(async () => {
    fs.rmSync(path, { force: true, recursive: true })
    return new Promise((resolve) => {
      const agServer = createServer({ path })
      algoliaServer = agServer.listen(port, resolve)
    })
  })

  afterEach(async () => {
    await index.clearObjects()
  })

  // I tried to make this afterEach, but algolia doesn't want to rebind to the port.
  afterAll(async () => {
    return new Promise((resolve) => {
      algoliaServer.close(() => {
        resolve()
      })
    })
  })

  it('supports a basic save and search', async () => {
    await index.saveObject({
      objectID: 'asdf',
      text: 'test'
    })
    const searchResults = await index.search('test')
    expect(searchResults.hits).toEqual([
      {
        objectID: 'asdf',
        text: 'test'
      }
    ])
  })

  it('supports deleting an object', async () => {
    await index.saveObject({
      objectID: 'asdf',
      text: 'test'
    })
    await index.deleteObject('asdf')
    const searchResults = await index.search('test')
    expect(searchResults.hits).toEqual([])
  })

  it('supports clearing an index', async () => {
    await index.saveObject({
      objectID: 'asdf',
      text: 'test'
    })
    await index.clearObjects()
    const searchResults = await index.search('test')
    expect(searchResults.hits).toEqual([])
  })

  describe('browseObjects', () => {
    it('supports a basic browse objects call', async () => {
      let objectsCreated = 0
      while (objectsCreated < 1300) {
        await index.saveObject({
          objectID: objectsCreated.toString(),
          text: 'test'
        })
        objectsCreated++
      }
      const results = []
      let total = 0
      await index.browseObjects({
        batch: (objects) => {
          total += objects.length
          results.push(objects)
        }
      })
      expect(total).toBe(1300)
      expect(results[0].length).toBe(1000)
      expect(results[0][results[0].length - 1]).toEqual({
        objectID: '999',
        text: 'test'
      })
      expect(results[1].length).toBe(300)
      expect(results[1][0]).toEqual({
        objectID: '1000',
        text: 'test'
      })
    })

    // test for off by one error
    it('works w/ exact page sizes', async () => {
      let objectsCreated = 0
      while (objectsCreated < 2000) {
        await index.saveObject({
          objectID: objectsCreated.toString(),
          text: 'test'
        })
        objectsCreated++
      }
      const results = []
      let total = 0
      await index.browseObjects({
        batch: (objects) => {
          total += objects.length
          results.push(objects)
        }
      })
      expect(total).toBe(2000)
      expect(results[0].length).toBe(1000)
      expect(results[0][results[0].length - 1].objectID).toBe('999')
      expect(results[1].length).toBe(1000)
      expect(results[1][0].objectID).toBe('1000')
    })

    it('supports retrieving only specified attributes', async () => {
      await index.saveObject({
        objectID: 'asdf',
        text: 'test',
        other: 'other'
      })
      await index.browseObjects({
        batch: (objects) => {
          expect(objects).toEqual([
            {
              objectID: 'asdf',
              text: 'test'
            }
          ])
        },
        attributesToRetrieve: ['text']
      })
    })

    // good luck, I don't have time to investigate this right now.
    // https://www.algolia.com/doc/rest-api/search/#browse-index-post
    it.todo('supports advanced browse options')
  })

  it('supports querying an object by id', async () => {
    await index.saveObject({
      objectID: 'asdf',
      text: 'test'
    })
    const object = await index.getObject('asdf')
    expect(object).toEqual({
      objectID: 'asdf',
      text: 'test'
    })
  })

  it("returns 404 for getObject when it doesn't exist", async () => {
    let rejected = false
    try {
      await index.getObject('asdf')
    } catch (e) {
      rejected = true
      expect(e).toEqual(
        expect.objectContaining({
          status: 404
        })
      )
    } finally {
      expect(rejected).toBe(true)
    }
  })
})
