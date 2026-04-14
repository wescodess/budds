import type { ChatMessage } from '../../utils/ai-gateway'

const SYSTEM_PROMPT = `You are Budds, a warm, encouraging study companion.
You help students think through problems, learn new concepts, and draft ideas.
Be concise, friendly, and honest about uncertainty.
When asked something that would benefit from course materials, mention the student can open one of their course folders to get sourced answers.`

export default defineEventHandler(async (event) => {
  getConvexTokenIdentifier(event)

  const body = await readBody<{
    query: string
    model: string
    history?: ChatMessage[]
    temperature?: number
    max_tokens?: number
  }>(event)

  if (!body.query?.trim()) {
    throw createError({ statusCode: 400, message: 'query is required' })
  }

  if (!body.model?.trim()) {
    throw createError({ statusCode: 400, message: 'model is required' })
  }

  const requestedModel = body.model
  let modelFallback: { requested: string; actual: string } | undefined
  if (!isAllowedModel(requestedModel)) {
    body.model = SERVER_DEFAULT_MODEL
    modelFallback = { requested: requestedModel, actual: SERVER_DEFAULT_MODEL }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ]

  if (body.history?.length) {
    const safeHistory = body.history.filter(
      (m): m is ChatMessage => m.role === 'user' || m.role === 'assistant',
    )
    messages.push(...safeHistory)
  }

  messages.push({ role: 'user', content: body.query })

  const completionParams = {
    messages,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
  }

  let completion: Awaited<ReturnType<typeof generateCompletion>>
  try {
    completion = await generateCompletion({ model: body.model, ...completionParams })
  }
  catch (err) {
    if (body.model !== SERVER_DEFAULT_MODEL) {
      modelFallback = { requested: body.model, actual: SERVER_DEFAULT_MODEL }
      completion = await generateCompletion({ model: SERVER_DEFAULT_MODEL, ...completionParams })
    }
    else {
      throw err
    }
  }

  return {
    answer: completion.choices[0]?.message?.content ?? '',
    model: completion.model,
    usage: completion.usage,
    ...(modelFallback && { modelFallback }),
  }
})
