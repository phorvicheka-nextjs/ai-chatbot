'use client'

import { useActions, useUIState } from 'ai/rsc'
import type { AI } from '@/lib/chat/actions'
import { nanoid } from 'nanoid'
import { UserMessage } from './stocks/message'

interface RelatedQuestion {
  question: string
}

export function RelatedQuestionsList({
  props: { relatedQuestions }
}: {
  props: {
    relatedQuestions: RelatedQuestion[]
  }
}) {
  const [messages, setMessages] = useUIState<typeof AI>()
  const { submitUserMessage } = useActions() // Import the useActions hook

  const handleClick = async (question: string) => {
    // Optimistically add user message UI
    setMessages(currentMessages => [
      ...currentMessages,
      {
        id: nanoid(),
        display: <UserMessage>{question}</UserMessage>
      }
    ])

    // Submit and get response message
    const responseMessage = await submitUserMessage(question)
    setMessages(currentMessages => [...currentMessages, responseMessage])
  }

  return (
    <div className="-mt-2 flex w-full flex-col gap-2 py-4">
      {relatedQuestions.map((relatedQuestion, index) => (
        <button
          key={index}
          onClick={() => handleClick(relatedQuestion.question)}
          className="flex shrink-0 flex-col gap-1 rounded-lg bg-zinc-800 p-4 text-left"
        >
          <div className="text-base font-bold text-zinc-200">
            Related Question {index + 1}
          </div>
          <div className="text-zinc-500">{relatedQuestion.question}</div>
        </button>
      ))}
    </div>
  )
}
