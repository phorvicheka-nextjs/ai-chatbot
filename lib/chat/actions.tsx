import 'server-only'

import {
  createAI,
  getMutableAIState,
  getAIState,
  streamUI,
  createStreamableValue
} from 'ai/rsc'

import { BotCard, BotMessage } from '@/components/stocks'

import { z } from 'zod'
import { StocksSkeleton } from '@/components/stocks/stocks-skeleton'
import { sleep, nanoid } from '@/lib/utils'
import { saveChat } from '@/app/actions'
import { SpinnerMessage, UserMessage } from '@/components/stocks/message'
import { Chat, Message } from '@/lib/types'
import { auth } from '@/auth'

import { createOpenAI } from '@ai-sdk/openai'
import { RelatedQuestionsList } from '@/components/related-questions-list'

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID,
  project: process.env.OPENAI_PROJECT_ID
})

async function submitUserMessage(content: string) {
  'use server'

  const aiState = getMutableAIState<typeof AI>()

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'user',
        content
      }
    ]
  })

  let textStream: undefined | ReturnType<typeof createStreamableValue<string>>
  let textNode: undefined | React.ReactNode

  const systemMessage = `\
      You are a cardiology Q&A bot that provides answers to patients' questions and suggests related questions. 
      When a user asks a question, you provide an answer and a list of related questions (give only 2 questions). 
      Use the following format:
      - "[Answer]" for the answer to the user's question.
      - "[Related Questions]" for the list of related questions, give only 2 questions.

      If there are [Related Questions], call \`answerAndRelatedQuestionsTool\` to show the related question list. Otherwise, just provide the answer.
      If the user requests more details or clarification, continue the conversation accordingly.`

  const result = await streamUI({
    model: openai('gpt-4o-2024-05-13'),
    // model: openai('gpt-3.5-turbo'),
    initial: <SpinnerMessage />,
    messages: [
      ...aiState.get().messages.map((message: any) => ({
        role: message.role,
        content: message.content,
        name: message.name
      }))
    ],
    text: ({ content, done, delta }) => {
      if (!textStream) {
        textStream = createStreamableValue('')
        textNode = <BotMessage content={textStream.value} />
      }

      if (done) {
        textStream.done()
        aiState.done({
          ...aiState.get(),
          messages: [
            ...aiState.get().messages,
            {
              id: nanoid(),
              role: 'assistant',
              content
            }
          ]
        })
      } else {
        textStream.update(delta)
      }

      return textNode
    },
    system: systemMessage,
    tools: {
      answerAndRelatedQuestionsTool: {
        description: 'Generate answer and related questions.',
        parameters: z.object({
          answer: z.string(),
          relatedQuestions: z.array(
            z.object({
              question: z.string().describe('The related question')
            })
          )
        }),
        generate: async function* ({ answer, relatedQuestions }) {
          // Display a skeleton UI while generating the response
          yield (
            <BotCard>
              <StocksSkeleton />{' '}
              {/* Replace with your own skeleton component if you have one */}
            </BotCard>
          )

          await sleep(1000)

          const toolCallId = nanoid()

          aiState.done({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolName: 'answerAndRelatedQuestionsTool',
                    toolCallId,
                    args: { answer, relatedQuestions }
                  }
                ]
              },
              {
                id: nanoid(),
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolName: 'answerAndRelatedQuestionsTool',
                    toolCallId,
                    result: { answer, relatedQuestions }
                  }
                ]
              }
            ]
          })

          return (
            <BotCard>
              <div>
                <p>{answer}</p>
                <RelatedQuestionsList
                  props={{
                    relatedQuestions
                  }}
                />
              </div>
            </BotCard>
          )
        }
      }
    },
    // temperature: 1,
    maxTokens: 256
    // topP: 1,
    // frequencyPenalty: 0,
    // presencePenalty: 0
  })

  return {
    id: nanoid(),
    display: result.value
  }
}

export type AIState = {
  chatId: string
  messages: Message[]
}

export type UIState = {
  id: string
  display: React.ReactNode
}[]

export const AI = createAI<AIState, UIState>({
  actions: {
    submitUserMessage
  },
  initialUIState: [],
  initialAIState: { chatId: nanoid(), messages: [] },
  onGetUIState: async () => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const aiState = getAIState()

      if (aiState) {
        const uiState = getUIStateFromAIState(aiState)
        return uiState
      }
    } else {
      return
    }
  },
  onSetAIState: async ({ state }) => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const { chatId, messages } = state

      const createdAt = new Date()
      const userId = session.user.id as string
      const path = `/chat/${chatId}`

      const firstMessageContent = messages[0].content as string
      const title = firstMessageContent.substring(0, 100)

      const chat: Chat = {
        id: chatId,
        title,
        userId,
        createdAt,
        messages,
        path
      }

      await saveChat(chat)
    } else {
      return
    }
  }
})

export const getUIStateFromAIState = (aiState: Chat) => {
  return aiState.messages
    .filter(message => message.role !== 'system')
    .map((message, index) => ({
      id: `${aiState.chatId}-${index}`,
      display:
        message.role === 'tool' ? (
          message.content.map(tool => {
            return tool.toolName === 'answerAndRelatedQuestionsTool' ? (
              <BotCard>
                <div>
                  {/* @ts-expect-error */}
                  <p>{tool.result.answer}</p>
                  {/* @ts-expect-error */}
                  <RelatedQuestionsList props={tool.result.relatedQuestions} />
                </div>
              </BotCard>
            ) : null
          })
        ) : message.role === 'user' ? (
          <UserMessage>{message.content as string}</UserMessage>
        ) : message.role === 'assistant' &&
          typeof message.content === 'string' ? (
          <BotMessage content={message.content} />
        ) : null
    }))
}
