import { useEffect, useRef, useState } from 'react'
import { Delete } from 'lucide-react'
import Modal from './Modal.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { CALCULATOR_TEXT } from '../i18n/calculator.js'

const MAX_EXPR_LENGTH = 40
const MAX_HISTORY = 1

// --- Safe expression evaluation — no eval(), a real recursive-descent
// parser instead, so parentheses and normal operator precedence (×÷ before
// +−) both work exactly like a real calculator, not a simple left-to-right
// chain. Internally uses plain -/* /*  since that's what the parser reads;
// the display itself still shows −×÷ everywhere else. ---

function tokenize(expr) {
  const src = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
  const tokens = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ') {
      i++
    } else if ('+-*/()%'.includes(ch)) {
      tokens.push(ch)
      i++
    } else if (/[0-9.]/.test(ch)) {
      let num = ch
      i++
      while (i < src.length && /[0-9.]/.test(src[i])) {
        num += src[i]
        i++
      }
      tokens.push(num)
    } else {
      // Anything unrecognized ends parsing right there — evaluate() below
      // treats a token stream that doesn't fully consume as a syntax error.
      i++
    }
  }
  return tokens
}

// Auto-closes any unmatched "(" — real calculators do this too, since
// requiring the user to manually balance parens before every "=" is just
// friction with no actual benefit.
function autoCloseParens(tokens) {
  let depth = 0
  for (const t of tokens) {
    if (t === '(') depth++
    if (t === ')') depth--
  }
  return depth > 0 ? [...tokens, ...Array(depth).fill(')')] : tokens
}

// Pressing "=" right after a trailing operator (e.g. "24+" with nothing
// typed after the "+" yet) is a real, well-known calculator convention —
// it repeats the last operand rather than refusing outright, e.g. "24+"
// becomes "24+24". Duplicates a whole "(...)" group intact if that's what
// the operator was trailing, not just a bare number.
function completeTrailingOperand(tokens) {
  const last = tokens[tokens.length - 1]
  if (!['+', '-', '*', '/'].includes(last)) return tokens
  const end = tokens.length - 2
  if (end < 0) return tokens.slice(0, -1) // a bare operator with nothing before it either — drop it
  let start = end
  if (tokens[end] === ')') {
    let depth = 0
    let i = end
    for (; i >= 0; i--) {
      if (tokens[i] === ')') depth++
      else if (tokens[i] === '(') depth--
      if (depth === 0) break
    }
    start = i
  } else if (end - 1 >= 0 && tokens[end - 1] === '-' && (end - 2 < 0 || ['+', '-', '*', '/', '('].includes(tokens[end - 2]))) {
    start = end - 1 // include a leading unary minus on the repeated number
  }
  return [...tokens, ...tokens.slice(start, end + 1)]
}

class ParseError extends Error {}

function parseExpression(tokens) {
  let pos = 0
  function peek() {
    return tokens[pos]
  }
  function consume() {
    return tokens[pos++]
  }

  // factor := ('-')? (number | '(' expr ')') ('%')?
  function factor() {
    let negate = false
    if (peek() === '-') {
      consume()
      negate = true
    }
    let value
    if (peek() === '(') {
      consume()
      value = expression()
      if (consume() !== ')') throw new ParseError('mismatched parentheses')
    } else if (peek() !== undefined && /^[0-9.]+$/.test(peek())) {
      value = parseFloat(consume())
      if (Number.isNaN(value)) throw new ParseError('bad number')
    } else {
      throw new ParseError('expected a number or (')
    }
    if (negate) value = -value
    while (peek() === '%') {
      consume()
      value = value / 100
    }
    return value
  }

  // term := factor (('*' | '/') factor)*
  function term() {
    let value = factor()
    while (peek() === '*' || peek() === '/') {
      const op = consume()
      const rhs = factor()
      value = op === '*' ? value * rhs : rhs === 0 ? NaN : value / rhs
    }
    return value
  }

  // expression := term (('+' | '-') term)*
  function expression() {
    let value = term()
    while (peek() === '+' || peek() === '-') {
      const op = consume()
      const rhs = term()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  const result = expression()
  if (pos !== tokens.length) throw new ParseError('unexpected trailing input')
  return result
}

// Never throws, never returns a non-finite value — any failure (a genuine
// syntax error, divide-by-zero, whatever) quietly falls back to 0 instead.
// A calculator that shows the word "Error" mid-task is more disruptive than
// useful here; 0 is a safe, obviously-a-fresh-start value to keep going from.
//
// Also returns `display`: the tokens actually evaluated, rendered back with
// the ×÷− symbols — NOT just the raw typed expr. completeTrailingOperand
// above means what's calculated can differ from what was typed (e.g. typing
// "56×" then "=" evaluates as "56×56"); history should show the former, not
// the latter, or a result like "= 3136" next to "56×" looks unexplained.
function evaluate(expr) {
  if (!expr.trim()) return { value: 0, display: expr }
  try {
    const tokens = autoCloseParens(completeTrailingOperand(tokenize(expr)))
    const value = parseExpression(tokens)
    const display = tokens.map((tok) => (tok === '*' ? '×' : tok === '/' ? '÷' : tok === '-' ? '−' : tok)).join('')
    return { value: Number.isFinite(value) ? value : 0, display }
  } catch {
    return { value: 0, display: expr }
  }
}

// Trims float noise (0.1 + 0.2 → 0.30000000000000004) without truncating a
// genuinely long, intentional result — 10 significant digits is plenty for
// anything this app's numbers actually need (cash/fuel figures, not science).
function formatResult(n) {
  const rounded = Math.round(n * 1e10) / 1e10
  return String(rounded)
}

const OPERATORS = new Set(['+', '−', '×', '÷'])

// Full expression-style calculator (parentheses + real operator precedence,
// not just a simple left-to-right chain, plus a short calculation history)
// — no save, no backend, nothing persisted. Reachable from anywhere via the
// top bar.
export default function CalculatorModal({ isOpen, onClose }) {
  const { language } = useLanguage()
  const t = CALCULATOR_TEXT[language]

  // expr/result/justEvaluated are deliberately NOT reset when the modal
  // closes (see the Modal's onClose below) — this component stays mounted
  // for the app's whole lifetime (Layout just toggles `isOpen`), so plain
  // React state already carries the in-progress expression across a
  // close/reopen for free, the same way `history` below always has. Reopen
  // it after checking something else and it's still exactly where it was
  // left, same convention every real pocket calculator follows.
  const [expr, setExpr] = useState('')
  const [result, setResult] = useState(null) // last computed value, shown as a live preview
  // True right after "=" — the next digit/"(" starts a fresh expression,
  // but the next operator continues on from the result (e.g. "=" then "+"
  // carries the answer forward, matching how every real calculator behaves).
  const [justEvaluated, setJustEvaluated] = useState(false)
  // Most recent first, capped at MAX_HISTORY.
  const [history, setHistory] = useState([])
  // The display below is a real, focusable input (not just a <p>) so typing
  // works the instant the modal opens without needing to click a button
  // first, and clicking directly into the display itself is a visible,
  // obvious way to put the keyboard focus there — it never actually holds
  // editable text (see its onKeyDown/onChange below), expr/displayValue
  // stay the single source of truth throughout.
  const displayInputRef = useRef(null)

  useEffect(() => {
    if (isOpen) displayInputRef.current?.focus()
  }, [isOpen])

  function resetAll() {
    setExpr('')
    setResult(null)
    setJustEvaluated(false)
  }

  // Pasting a value (Ctrl/Cmd+V, or a browser/OS "Paste" menu action) lands
  // it as the next operand — same rule append() already uses for typed
  // digits: right after "=" it starts a fresh expression, otherwise it's
  // appended to whatever's already there (e.g. "12+" then pasting "45"
  // gives "12+45"). Only ever reads clipboard TEXT, and only keeps
  // characters a bare number can contain — a pasted "₹1,234.50" or
  // "1234.50 " lands as a clean 1234.50 instead of being silently rejected
  // or corrupting the expression with a character this calculator's parser
  // doesn't understand. Anything that isn't recognizable as one plain
  // number (a sentence, multiple numbers, empty clipboard) is a no-op —
  // never partially inserted.
  function pasteNumber(text) {
    const cleaned = (text || '').trim().replace(/[^0-9.-]/g, '')
    if (!/^-?\d*\.?\d+$/.test(cleaned)) return
    setExpr((prev) => {
      const base = justEvaluated ? '' : prev
      const next = base + cleaned
      return next.length > MAX_EXPR_LENGTH ? base : next
    })
    setJustEvaluated(false)
  }

  function append(token, { isOperator = false, isOpenParen = false } = {}) {
    setExpr((prev) => {
      let base = prev
      if (justEvaluated) {
        base = isOperator ? (result != null ? formatResult(result) : '') : ''
      }
      if (base.length >= MAX_EXPR_LENGTH) return base
      // Two operators in a row just swaps the pending one, rather than
      // producing something like "12+×3" that can never evaluate.
      if (isOperator && OPERATORS.has(base.slice(-1))) {
        return base.slice(0, -1) + token
      }
      if (isOpenParen) return base + token
      return base + token
    })
    setJustEvaluated(false)
  }

  function backspace() {
    if (justEvaluated) {
      resetAll()
      return
    }
    setExpr((prev) => prev.slice(0, -1))
  }

  function handleEquals() {
    if (!expr.trim()) return
    const { value, display } = evaluate(expr)
    setResult(value)
    setHistory((prev) => [{ expr: display, value }, ...prev].slice(0, MAX_HISTORY))
    setJustEvaluated(true)
  }

  // Tapping a past result loads it as a fresh starting point — the same
  // as if you'd just typed that number in.
  function reuseHistoryEntry(value) {
    setExpr(formatResult(value))
    setResult(value)
    setJustEvaluated(true)
  }

  // Live preview of the result as you type — e.g. mid-typing "12+3×4" shows
  // "= 24" below without waiting for "=" to be pressed, same as a phone
  // calculator's own live preview. Deliberately NOT using the trailing-
  // operator repeat trick here — that's specifically an "=" behavior, not
  // something that should sneak in a guess while still mid-typing.
  useEffect(() => {
    if (justEvaluated) return
    try {
      const tokens = autoCloseParens(tokenize(expr))
      const value = parseExpression(tokens)
      setResult(Number.isFinite(value) ? value : null)
    } catch {
      setResult(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expr])

  useEffect(() => {
    if (!isOpen) return undefined
    function onKeyDown(e) {
      if (e.key >= '0' && e.key <= '9') append(e.key)
      else if (e.key === '.') append('.')
      else if (e.key === '+') append('+', { isOperator: true })
      else if (e.key === '-') append('−', { isOperator: true })
      else if (e.key === '*') append('×', { isOperator: true })
      else if (e.key === '/') {
        e.preventDefault()
        append('÷', { isOperator: true })
      } else if (e.key === '(') append('(', { isOpenParen: true })
      else if (e.key === ')') append(')')
      else if (e.key === '%') append('%')
      else if (e.key === 'Enter' || e.key === '=') handleEquals()
      else if (e.key === 'Backspace') backspace()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, expr, result, justEvaluated])

  const opButtonClass =
    'rounded-xl bg-brand-100 text-xl font-bold text-brand-700 transition-colors hover:bg-brand-200 active:scale-95'
  const digitButtonClass =
    'rounded-xl bg-slate-100 text-xl font-semibold text-slate-800 transition-colors hover:bg-slate-200 active:scale-95'
  const utilButtonClass =
    'rounded-xl bg-slate-50 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-100 active:scale-95'

  const displayValue = justEvaluated ? formatResult(result) : expr || '0'
  const previewValue = !justEvaluated && result != null && expr.trim() ? formatResult(result) : null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.title} maxWidth="max-w-md">
      <div className="space-y-2">
        {history.length > 0 ? (
          <div className="max-h-20 space-y-0.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5">
            {history.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => reuseHistoryEntry(h.value)}
                className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-slate-100"
              >
                <span className="truncate text-xs text-slate-400">{h.expr}</span>
                <span className="shrink-0 text-xs font-semibold text-slate-600">= {formatResult(h.value)}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="rounded-xl bg-slate-900 px-4 py-4 text-right">
          <p className="mb-0.5 h-[16px] truncate text-xs font-medium text-slate-400">
            {previewValue != null ? `= ${previewValue}` : ' '}
          </p>
          {/* A real input, not a <p> — clicking straight into the display
              (not just the buttons below) now visibly focuses it with a
              blinking caret, confirming the keyboard is live. It never
              actually holds editable text: value is fully controlled from
              expr/result above, and onKeyDown only blocks the browser's own
              native character insertion — the actual key handling is the
              same window-level listener below, which fires regardless of
              what has focus, this input included. Ctrl/Cmd+V is the one key
              combo let through (not preventDefault'd) so the browser still
              fires its native paste event for onPaste below to catch. */}
          <input
            ref={displayInputRef}
            value={displayValue}
            onChange={() => {}}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return
              e.preventDefault()
            }}
            onPaste={(e) => {
              e.preventDefault()
              pasteNumber(e.clipboardData.getData('text'))
            }}
            inputMode="none"
            aria-label={t.title}
            className="w-full truncate border-0 bg-transparent text-right text-3xl font-bold text-white caret-white outline-none"
          />
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          <button type="button" onClick={resetAll} className={`${utilButtonClass} py-3`}>
            AC
          </button>
          <button type="button" onClick={() => append('(', { isOpenParen: true })} className={`${utilButtonClass} py-3`}>
            (
          </button>
          <button type="button" onClick={() => append(')')} className={`${utilButtonClass} py-3`}>
            )
          </button>
          <button type="button" onClick={backspace} aria-label="Backspace" className={`${utilButtonClass} flex items-center justify-center py-3`}>
            <Delete size={18} />
          </button>

          {['7', '8', '9'].map((d) => (
            <button key={d} type="button" onClick={() => append(d)} className={`${digitButtonClass} py-3`}>
              {d}
            </button>
          ))}
          <button type="button" onClick={() => append('÷', { isOperator: true })} className={`${opButtonClass} py-3`}>
            &divide;
          </button>

          {['4', '5', '6'].map((d) => (
            <button key={d} type="button" onClick={() => append(d)} className={`${digitButtonClass} py-3`}>
              {d}
            </button>
          ))}
          <button type="button" onClick={() => append('×', { isOperator: true })} className={`${opButtonClass} py-3`}>
            &times;
          </button>

          {['1', '2', '3'].map((d) => (
            <button key={d} type="button" onClick={() => append(d)} className={`${digitButtonClass} py-3`}>
              {d}
            </button>
          ))}
          <button type="button" onClick={() => append('−', { isOperator: true })} className={`${opButtonClass} py-3`}>
            &minus;
          </button>

          <button type="button" onClick={() => append('%')} className={`${utilButtonClass} py-3`}>
            %
          </button>
          <button type="button" onClick={() => append('0')} className={`${digitButtonClass} py-3`}>
            0
          </button>
          <button type="button" onClick={() => append('.')} className={`${digitButtonClass} py-3`}>
            .
          </button>
          <button type="button" onClick={() => append('+', { isOperator: true })} className={`${opButtonClass} py-3`}>
            +
          </button>

          <button
            type="button"
            onClick={handleEquals}
            className="col-span-4 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 py-3 text-xl font-bold text-white shadow-md shadow-brand-600/30 transition-all hover:from-brand-600 hover:to-brand-800 active:scale-95"
          >
            =
          </button>
        </div>
      </div>
    </Modal>
  )
}
