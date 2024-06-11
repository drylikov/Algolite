const si = require('search-index')
const path = require('path')
const fs = require('fs')
const level = require('level')

const indexes = {}
const stores = {}
module.exports.getIndex = (indexName, storePath) => {
  const index = indexes[indexName]
  const basePath = path.join(storePath, '.algolite')
  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true })
  }

  if (!index) {
    stores[indexName] = level(path.join(basePath, indexName), {
      valueEncoding: 'json'
    })
    indexes[indexName] = si({
      store: stores[indexName]
    })
  }

  return indexes[indexName]
}

module.exports.resetIndex = (indexName) => {
  if (stores[indexName]) {
    stores[indexName].clear()
  }
}

module.exports.existIndex = (indexName, storePath) => {
  const basePath = path.join(storePath, '.algolite', indexName)

  return fs.existsSync(basePath)
}
