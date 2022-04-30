/**
 * なでしこの構文解析のためのユーティリティクラス
 */
export class NakoParserBase {
  /**
   * @param {import("./nako_logger.mjs")} logger
   */
  constructor (logger) {
    this.logger = logger
    /** @type any[] */
    this.stackList = [] // 関数定義の際にスタックが混乱しないように整理する
    /** @type {import('./nako3.mjs').TokenWithSourceMap[]} */
    this.tokens = []
    /** @type {import('./nako3.mjs').Ast[]} */
    this.stack = []
    this.index = 0
    /** トークン出現チェック(accept関数)に利用する 
     * @type {import('./nako3.mjs').Ast[]}
     */
    this.y = []
    /** モジュル名 @type {string} */
    this.modName = 'inline'
    /** 利用するモジュールの名前一覧 @type {array[string]} */
    this.modList = []
    /** グローバル変数・関数の確認用 */
    this.funclist = {}
    /** ローカル変数の確認用 */
    this.localvars = {'それ': {type: 'var', value: ''}}
    /** コード生成器の名前 */
    this.genMode = 'sync' // #637
    this.arrayIndexFrom = 0  // #1140
    this.flagReverseArrayIndex = false // #1140
    this.flagCheckArrayInit = false // #1140
    /** @type Object[] */
    this.recentlyCalledFunc = [] // 最近呼び出した関数(余剰エラーの報告に使う)

    this.init()
  }

  init () {
    this.funclist = {} // 関数の一覧
    this.reset()
  }

  reset () {
    /** @type {import('./nako3.mjs').TokenWithSourceMap[]} */
    this.tokens = [] // 字句解析済みのトークンの一覧を保存
    this.index = 0 // tokens[] のどこまで読んだかを管理する
    this.stack = [] // 計算用のスタック ... 直接は操作せず、pushStack() popStack() を介して使う
    this.y = [] // accept()で解析済みのトークンを配列で得るときに使う
    this.genMode = 'sync' // #637, #1056
  }

  setFuncList (funclist) {
    this.funclist = funclist
  }

  /**
   * 特定の助詞を持つ要素をスタックから一つ下ろす、指定がなければ末尾を下ろす
   * @param {string[]} josiList 下ろしたい助詞の配列
   * @returns {import('./nako3').Ast | null | undefined}
   */
  popStack (josiList) {
    if (!josiList) { return this.stack.pop() }

    // josiList にマッチする助詞を探す
    for (let i = 0; i < this.stack.length; i++) {
      const t = this.stack[i]
      if (josiList.length === 0 || josiList.indexOf(t.josi) >= 0) {
        this.stack.splice(i, 1) // remove stack
        this.logger.trace('POP :' + JSON.stringify(t))
        return t
      }
    }
    // 該当する助詞が見つからなかった場合
    return null
  }

  /**
   * saveStack と loadStack は対で使う。
   * 関数定義などでスタックが混乱しないように配慮するためのもの
   */
  saveStack () {
    this.stackList.push(this.stack)
    this.stack = []
  }

  loadStack () {
    this.stack = this.stackList.pop()
    this.localvars = {'それ': {type: 'var', value: ''}}
  }

  /** 変数名を探す
   * @param {string} name
   * @returns {any}変数名の情報
   */
  findVar(name) {
    // ローカル変数？
    if (this.localvars[name]) {
      return {
        name: name,
        scope: 'local',
        info: this.localvars[name]
      }
    }
    // グローバル変数（モジュールを検索）？
    for (let mod of this.modList) {
      const gname = `${mod}__${name}`
      if (this.funclist[gname]) {
        return {
          name: gname,
          scope: 'global',
          info: this.funclist[gname] 
        }
      }
    }
    // システム変数 (funclistを普通に検索)
    if (this.funclist[name]) {
      return {
        name,
        scope: 'system',
        info: this.funclist[name]
      }
    }
    return undefined
  }

  /**
   * 計算用に要素をスタックに積む
   */
  pushStack (item) {
    this.logger.debug('PUSH:' + JSON.stringify(item))
    this.stack.push(item)
  }

  /**
   * トークンの末尾に達したか
   */
  isEOF () {
    return (this.index >= this.tokens.length)
  }

  /**
   * カーソル位置にある単語の型を確かめる
   */
  check (ttype) {
    return (this.tokens[this.index].type === ttype)
  }

  /**
   * カーソル位置以降にある単語の型を確かめる 2単語以上に対応
   * @param a [単語1の型, 単語2の型, ... ]
   */
  check2 (a) {
    for (let i = 0; i < a.length; i++) {
      const idx = i + this.index
      if (this.tokens.length <= idx) { return false }
      if (a[i] === '*') { continue } // ワイルドカード(どんなタイプも許容)
      const t = this.tokens[idx]
      if (a[i] instanceof Array) {
        if (a[i].indexOf(t.type) < 0) { return false }
        continue
      }
      if (t.type !== a[i]) { return false }
    }
    return true
  }

  /**
   * カーソル位置の型を確認するが、複数の種類を確かめられる
   */
  checkTypes (a) {
    const type = this.tokens[this.index].type
    return (a.indexOf(type) >= 0)
  }

  /**
   * check2の高度なやつ、型名の他にコールバック関数を指定できる
   * 型にマッチしなければ null を返し、カーソルを巻き戻す
   */
  accept (types) {
    const y = []
    const tmpIndex = this.index
    const rollback = () => {
      this.index = tmpIndex
      return false
    }
    for (let i = 0; i < types.length; i++) {
      if (this.isEOF()) { return rollback() }
      const type = types[i]
      if (typeof type === 'string') {
        const token = this.get()
        if (token.type !== type) { return rollback() }
        y[i] = token
        continue
      }
      if (typeof type === 'function') {
        const f = type.bind(this)
        const r = f(y)
        if (r === null) { return rollback() }
        y[i] = r
        continue
      }
      if (type instanceof Array) {
        if (!this.checkTypes(type)) { return rollback() }
        y[i] = this.get()
        continue
      }
      throw new Error('System Error : accept broken : ' + typeof type)
    }
    this.y = y
    return true
  }

  /**
   * カーソル語句を取得して、カーソルを後ろに移動する
   * @returns {import('./nako3').TokenWithSourceMap | null}
   */
  get () {
    if (this.isEOF()) { return null }
    return this.tokens[this.index++]
  }

  unget () {
    if (this.index > 0) { this.index-- }
  }

  /**
   * @returns {import('./nako3').TokenWithSourceMap | null}
   */
  peek (i = 0) {
    if (this.isEOF()) { return null }
    return this.tokens[this.index + i]
  }

  /**
   * 現在のカーソル語句のソースコード上の位置を取得する。
   * @returns {{
   *     startOffset: number | null
   *     endOffset: number | null
   *     file: string | undefined
   *     line: number
   *     column: number
   * }}
   */
  peekSourceMap () {
    const token = this.peek()
    if (token === null) {
      return { startOffset: null, endOffset: null, file: undefined, line: 0, column: 0 }
    }
    return { startOffset: token.startOffset, endOffset: token.endOffset, file: token.file, line: token.line, column: token.column }
  }

  /**
   * depth: 表示する深さ
   * typeName: 先頭のtypeの表示を上書きする場合に設定する
   * @param {{ depth: number, typeName?: string }} opts
   * @param {boolean} debugMode
   */
  nodeToStr (node, opts, debugMode) {
    const depth = opts.depth - 1
    const typeName = (name) => opts.typeName !== undefined ? opts.typeName : name
    const debug = debugMode ? (' debug: ' + JSON.stringify(node, null, 2)) : ''
    if (!node) {
      return '(NULL)'
    }
    switch (node.type) {
      case 'not':
        if (depth >= 0) {
          return `${typeName('')}『${this.nodeToStr(node.value, { depth }, debugMode)}に演算子『not』を適用した式${debug}』`
        } else {
          return `${typeName('演算子')}『not』`
        }
      case 'op': {
        let operator = node.operator
        const table = { eq: '＝', not: '!', gt: '>', lt: '<', and: 'かつ', or: 'または' }
        if (operator in table) {
          operator = table[operator]
        }
        if (depth >= 0) {
          const left = this.nodeToStr(node.left, { depth }, debugMode)
          const right = this.nodeToStr(node.right, { depth }, debugMode)
          if (node.operator === 'eq') {
            return `${typeName('')}『${left}と${right}が等しいかどうかの比較${debug}』`
          }
          return `${typeName('')}『${left}と${right}に演算子『${operator}』を適用した式${debug}』`
        } else {
          return `${typeName('演算子')}『${operator}${debug}』`
        }
      }
      case 'number':
        return `${typeName('数値')}${node.value}`
      case 'string':
        return `${typeName('文字列')}『${node.value}${debug}』`
      case 'word':
        return `${typeName('単語')}『${node.value}${debug}』`
      case 'func':
        return `${typeName('関数')}『${node.name || node.value}${debug}』`
      case 'eol':
        return '行の末尾'
      case 'eof':
        return 'ファイルの末尾'
      default: {
        let name = node.name
        if (!name) { name = node.value }
        if (typeof name !== 'string') { name = node.type }
        return `${typeName('')}『${name}${debug}』`
      }
    }
  }
}
