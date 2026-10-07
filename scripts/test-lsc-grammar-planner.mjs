import assert from 'node:assert/strict'
import { planSpanishToLsc } from '../src/utils/lscGrammarPlanner.js'
import { compileSignPlanToPlayTokens } from '../src/utils/signPlan.js'
import { analyzeConversationTurn, createConversationContext } from '../src/utils/conversationContext.js'
import { expandTokens } from '../src/utils/fingerspell.js'

const letters = 'A B C D E F G H I J K L M N Ñ O P Q R S T U V W X Y Z'.split(' ')
const available = [...letters, 'MAÑANA', 'COMO_ESTAS']
const text = 'Tenemos clase mañana'
const context = analyzeConversationTurn(text, createConversationContext())
const plan = planSpanishToLsc({
  sourceText: text,
  availableTokens: available,
  fallbackResolver: (words, tokens) => expandTokens(words, tokens),
  context,
})

const playable = compileSignPlanToPlayTokens(plan)
assert.equal(playable[0], 'MAÑANA')
assert.equal(plan.intent, 'statement')
assert.equal(plan.metadata.topic, 'educación')
assert.equal(plan.metadata.grammarPlanner, 'lsc-rule-v1')
assert.ok(plan.tokens.some((token) => token.type === 'facial' && token.payload.mode === 'neutral'))

console.log('OK planificador LSC: tiempo al inicio, contexto y modificador facial')
