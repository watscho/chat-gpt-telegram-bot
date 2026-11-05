import type { Config } from '../config.js'
import { UserError } from '../domain/conversation.js'
import type {
  RecipeStep,
  WorkflowId,
  WorkflowSpec,
  SuiteRow
} from '../domain/suite.js'
export const suiteCatalog: Record<
  WorkflowId,
  { title: string; fields: string[]; instruction: string; local?: string }
> = {
  brand: {
    title: 'Branded document',
    fields: ['heading', 'text'],
    instruction:
      'Write a useful document with sections and Markdown tables. Preserve supplied facts and mark gaps.',
    local: 'document'
  },
  travel: {
    title: 'Travel assistant',
    fields: [
      'date',
      'time',
      'location',
      'booking',
      'action',
      'source',
      'quote'
    ],
    instruction:
      'Build a travel itinerary from supplied bookings. Preserve time zones. Mark unknown schedules, prices and visa requirements; do not invent live information.',
    local: 'record'
  },
  learn: {
    title: 'Continuing learning',
    fields: ['lesson', 'exercise', 'feedback', 'mistake', 'next'],
    instruction:
      'Teach one short lesson and ask one exercise. For an answer, assess it, retain specific mistakes and adapt the next lesson. Feedback is an assessment, not certification.',
    local: 'record'
  },
  rehearse: {
    title: 'Conversation rehearsal',
    fields: ['role', 'turn', 'feedback', 'next'],
    instruction:
      'Rehearse the requested conversation. Play the counterpart, give one realistic turn, then actionable feedback. Keep fiction separate from real commitments.',
    local: 'record'
  },
  purchase: {
    title: 'Purchase comparison',
    fields: [
      'offer',
      'currency',
      'base',
      'shipping',
      'tax',
      'discount',
      'warranty',
      'risk',
      'source'
    ],
    instruction:
      'Compare supplied offers. Price components must be integer minor units or null, with ISO currency. Never invent taxes, exchange rates or live availability. State warranty and return gaps.',
    local: 'purchase'
  },
  sendcheck: {
    title: 'Pre-send review',
    fields: ['issue', 'severity', 'evidence', 'suggestion'],
    instruction:
      'Review the intended message before sending. Check tone, ambiguity, recipients, promises, sensitive details and missing attachments. Return findings and a revised draft; do not send anything.'
  },
  video: {
    title: 'Recorded video review',
    fields: ['timestamp', 'observation', 'evidence', 'uncertainty', 'action'],
    instruction:
      'Analyze only timestamped sampled frames and supplied transcript. Cite sampled timestamps, separate observations from inference, and disclose unsampled intervals. Never claim full video coverage.'
  },
  brief: {
    title: 'Meeting preparation',
    fields: ['topic', 'context', 'source', 'question', 'decision'],
    instruction:
      'Prepare a meeting brief from explicitly supplied sources: background, unresolved decisions, questions and a concise agenda. Attribute claims and identify missing context.'
  },
  repurpose: {
    title: 'Content repurposing',
    fields: ['format', 'title', 'text'],
    instruction:
      'Repurpose the supplied source into email, status, post, brief and checklist. Preserve factual meaning and distinguish interpretation. Do not publish.',
    local: 'repurpose'
  },
  quality: {
    title: 'Personal quality review',
    fields: ['criterion', 'status', 'evidence', 'improvement'],
    instruction:
      'Apply the supplied personal quality criteria individually. Use pass, review or fail; cite evidence and propose specific improvements. Missing evidence requires review.'
  },
  screen: {
    title: 'Annotated screenshot guidance',
    fields: ['label', 'action', 'x', 'y', 'width', 'height'],
    instruction:
      'Identify up to 12 useful regions on the supplied screenshot. Coordinates must be integer strings normalized to 0..1000; rectangles must fit. Give precise actions. Coordinates are estimates for human review.',
    local: 'screen'
  },
  decision: {
    title: 'Sourced decision journal',
    fields: ['decision', 'reason', 'alternative', 'source', 'quote'],
    instruction:
      'Extract decisions with reasons and alternatives. Every row must cite a supplied source ID and an exact nonempty quote from that source. Do not turn suggestions into decisions.',
    local: 'record'
  },
  form: {
    title: 'Reviewed form filling',
    fields: ['field', 'label', 'value', 'required', 'source'],
    instruction:
      'Extract form fields from the supplied form and propose values only from supplied facts. Use null for missing values, unique safe field names and yes/no required. Do not submit forms.',
    local: 'record'
  },
  commitment: {
    title: 'Quoted commitment tracking',
    fields: ['person', 'action', 'date', 'source', 'quote'],
    instruction:
      'Extract explicit commitments only. Each row needs a supplied source ID and an exact nonempty quote. Unknown dates are null. Do not create reminders or contact anyone.',
    local: 'record'
  },
  referee: {
    title: 'Independent model review',
    fields: ['claim', 'assessment', 'evidence', 'disagreement', 'correction'],
    instruction:
      'Independently review the previous answer against supplied evidence. Identify unsupported claims, disagreements and corrections. Agreement is not proof of truth.'
  }
}
export function workflowSpec(
  id: string,
  params: Record<string, string> = {}
): WorkflowSpec {
  if (!Object.hasOwn(suiteCatalog, id))
    throw new UserError('Unknown Pro Suite workflow. Use /suite.')
  const key = id as WorkflowId
  return {
    id: key,
    phase: 'compose',
    record: null,
    params,
    fields: [...suiteCatalog[key].fields],
    model: null,
    format: null
  }
}
export function compileWorkflow(
  config: Config,
  spec: WorkflowSpec,
  primary: string
): RecipeStep[] {
  const definition = suiteCatalog[spec.id]
  if (!definition || spec.fields.join() !== definition.fields.join())
    throw new UserError('Workflow schema changed. Create a fresh plan.')
  const make = (
    phase: string,
    kind: RecipeStep['kind'],
    prompt: string,
    model: string | null = null
  ): RecipeStep => ({
    kind,
    title: `${definition.title}: ${phase}`,
    prompt,
    connection: null,
    workflow: { ...structuredClone(spec), phase, model }
  })
  const steps: RecipeStep[] = []
  if (spec.id === 'video')
    steps.push(
      make(
        'sample',
        'media',
        'Prepare bounded timestamped video frames and optional audio transcript.'
      )
    )
  if (spec.id === 'referee') {
    const reviewer = spec.params.model
    if (
      !reviewer ||
      reviewer === primary ||
      !config.suite.reviewModels.includes(reviewer)
    )
      throw new UserError(
        'Choose a different allowlisted review model. /suite models lists configured options.'
      )
    steps.push(
      make(
        'draft',
        'compose',
        'Answer the goal carefully from the supplied evidence.',
        primary
      )
    )
    steps.push(make('review', 'compose', definition.instruction, reviewer))
  } else steps.push(make('compose', 'compose', definition.instruction, primary))
  if (definition.local)
    steps.push(
      make(
        definition.local,
        'local',
        'Validate the structured result and prepare a local artifact or explicit record review.'
      )
    )
  return steps
}
export function workflowRows(text: string, fields: string[]): SuiteRow[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).join() === 'rows'
    )
      parsed = (parsed as { rows: unknown }).rows
  } catch {
    throw new UserError(
      'Workflow returned invalid JSON. Inspect its retained model result; local validation made no new model call.'
    )
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.length ||
    parsed.length > 100 ||
    parsed.some(
      (row: unknown) =>
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).length !== fields.length ||
        fields.some(
          key =>
            !Object.hasOwn(row, key) ||
            ((row as Record<string, unknown>)[key] !== null &&
              (typeof (row as Record<string, unknown>)[key] !== 'string' ||
                ((row as Record<string, unknown>)[key] as string).length >
                  6000))
        )
    )
  )
    throw new UserError('Workflow rows do not match the reviewed schema.')
  return parsed as SuiteRow[]
}
export function offerTotal(row: SuiteRow): string {
  const values = ['base', 'shipping', 'tax', 'discount'].map(key => row[key])
  if (
    !/^[A-Z]{3}$/.test(row.currency ?? '') ||
    values.some(
      value =>
        value === null || value === undefined || !/^\d{1,15}$/.test(value)
    )
  )
    return 'Unknown: confirm currency and all price components.'
  const [base, shipping, tax, discount] = values.map(value => BigInt(value!))
  const total = base! + shipping! + tax! - discount!
  if (total < 0n)
    throw new UserError('Offer discount exceeds the supplied price components.')
  return `${row.currency} ${total} minor units (no currency conversion)`
}
