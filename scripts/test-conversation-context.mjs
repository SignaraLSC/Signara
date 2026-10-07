import assert from 'node:assert/strict'
import {
  analyzeConversationTurn,
  createConversationContext,
  summarizeConversationContext,
} from '../src/utils/conversationContext.js'

let context = createConversationContext()
context = analyzeConversationTurn('¿Mañana tenemos clase?', context)
assert.equal(context.topic, 'educación')
assert.equal(context.activeTime.value, 'mañana_día')
assert.equal(context.intent, 'question')
assert.equal(context.facial.mode, 'question')

context = analyzeConversationTurn('Él entrega la tarea', context)
assert.equal(context.topic, 'educación')
assert.ok(context.people.some((person) => person.role === 'third'))
assert.equal(context.spatialLoci['3-singular-third'], 'third')
assert.equal(context.activeTime.value, 'mañana_día')

context = analyzeConversationTurn('Nosotros estudiamos por la mañana', context)
assert.equal(context.activeTime.value, 'mañana_periodo')
assert.ok(context.people.some((person) => person.role === 'group_self'))
assert.match(summarizeConversationContext(context), /educación/)

console.log('OK memoria conversacional: tema, tiempo, intención, rostro y referentes')
