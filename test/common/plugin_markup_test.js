const assert = require('assert')
const NakoCompiler = require('../../src/nako3')
const PluginMarkup = require('../../src/plugin_markup')

describe('plugin_markup_test', () => {
  const nako = new NakoCompiler()
  nako.addPluginObject('PluginMarkup', PluginMarkup)
  
  const cmp = (code, res) => {
    nako.logger.debug('code=' + code)
    assert.strictEqual(nako.run(code).log, res)
  }

  // --- test ---
  it('マークダウンHTML変換', () => {
    cmp('「test `test` test」をマークダウンHTML変換して表示', '<p>test <code>test</code> test</p>')
  })
  it('HTML整形', () => {
    cmp('「<p><h1>hoge</h1></p>」をHTML整形して表示', '<p>\n  <h1>hoge</h1>\n</p>')
  })
})
