import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import { UserError } from '../domain/conversation.js'
import type { StateStore } from '../domain/state.js'
import type {
  BrandTemplate,
  QualityRule,
  Recipe,
  RecipeStep,
  RecordKind,
  SourceQuote,
  SuitePending,
  SuiteRecord,
  SuiteState
} from '../domain/suite.js'
const newId = () => randomUUID().slice(0, 12)
export function suiteName(value: string): string {
  const name = value.trim()
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(name))
    throw new UserError(
      'Use a name with 1..32 letters, digits, underscores or hyphens.'
    )
  return name
}
export function suiteStrings(value: Record<string, string>, max = 6000): void {
  if (
    Object.keys(value).length > 30 ||
    Object.entries(value).some(
      ([key, text]) =>
        !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(key) ||
        ['constructor', 'prototype', '__proto__'].includes(key) ||
        typeof text !== 'string' ||
        text.length > max
    )
  )
    throw new UserError('Fields contain invalid names, values or lengths.')
}
export class Suite {
  private readonly cache = new Map<string, SuiteState>()
  constructor(
    private readonly config: Config,
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  get(owner: string): SuiteState {
    const state = structuredClone(
      this.cache.get(owner) ??
        this.store?.getRecord<SuiteState>('suite', owner) ?? {
          records: [],
          templates: [],
          criteria: [],
          recipes: [],
          pending: null,
          selected: [],
          listening: null
        }
    )
    let expired = false
    if (state.pending && state.pending.expiresAt <= this.now()) {
      state.pending = null
      expired = true
    }
    if (state.listening && state.listening.expiresAt <= this.now()) {
      state.listening = null
      expired = true
    }
    if (expired) this.save(owner, state)
    return state
  }
  private save(owner: string, state: SuiteState): void {
    if (
      state.records.length > 100 ||
      state.templates.length > 20 ||
      state.criteria.length > 30 ||
      state.recipes.length > 20 ||
      state.selected.length > 20 ||
      Buffer.byteLength(JSON.stringify(state)) > this.config.maxJobBytes
    )
      throw new UserError(
        'Pro Suite storage/capacity is full. Remove unused records or pending material first.'
      )
    this.store?.putRecord('suite', owner, state)
    this.cache.set(owner, structuredClone(state))
  }
  refresh(owner: string): void {
    this.cache.delete(owner)
  }
  erase(owner: string): void {
    this.store?.deleteRecord('suite', owner)
    this.cache.delete(owner)
  }
  deleteThread(owner: string, thread: string): void {
    const state = this.get(owner)
    if (state.pending?.thread === thread) state.pending = null
    if (state.listening?.thread === thread) state.listening = null
    this.save(owner, state)
  }
  select(owner: string, source: SourceQuote): void {
    if (
      !source.id ||
      source.title.length > 200 ||
      !source.text.trim() ||
      source.text.length > 12000
    )
      throw new UserError('Choose a nonempty, bounded source excerpt.')
    const state = this.get(owner)
    state.selected = [
      ...state.selected.filter(item => item.id !== source.id),
      source
    ]
    this.save(owner, state)
  }
  clearSelected(owner: string): void {
    const state = this.get(owner)
    state.selected = []
    this.save(owner, state)
  }
  criteria(owner: string, project: string | null): QualityRule[] {
    return this.get(owner).criteria.filter(
      rule => rule.project === null || rule.project === project
    )
  }
  qualityText(owner: string, project: string | null): string {
    return this.criteria(owner, project)
      .map(rule => `${rule.id}: ${rule.label} — ${rule.check}`)
      .join('\n')
  }
  criterion(
    owner: string,
    project: string | null,
    label: string,
    check: string
  ): QualityRule {
    if (
      !label.trim() ||
      label.length > 100 ||
      !check.trim() ||
      check.length > 400
    )
      throw new UserError(
        'Use a criterion label of 1..100 and check of 1..400 characters.'
      )
    const state = this.get(owner),
      rule = { id: newId(), project, label: label.trim(), check: check.trim() }
    state.criteria.push(rule)
    this.save(owner, state)
    return rule
  }
  removeCriterion(owner: string, id: string): void {
    const state = this.get(owner)
    if (!state.criteria.some(rule => rule.id === id))
      throw new UserError('Criterion not found.')
    state.criteria = state.criteria.filter(rule => rule.id !== id)
    this.save(owner, state)
  }
  template(owner: string, name: string): BrandTemplate {
    const item = this.get(owner).templates.find(item => item.name === name)
    if (!item && name === 'default')
      return {
        name: 'default',
        revision: 1,
        brand: 'Pro Suite',
        accent: '287F78',
        font: 'Noto Sans',
        footer: 'Prepared for review',
        headings: []
      }
    if (!item) throw new UserError('Brand template not found.')
    return item
  }
  saveTemplate(owner: string, value: BrandTemplate): BrandTemplate {
    suiteName(value.name)
    if (
      !value.brand.trim() ||
      value.brand.length > 100 ||
      !/^[A-Fa-f0-9]{6}$/.test(value.accent) ||
      !/^[a-zA-Z0-9 -]{1,60}$/.test(value.font) ||
      value.footer.length > 200 ||
      value.headings.length > 12 ||
      value.headings.some(text => !text.trim() || text.length > 100)
    )
      throw new UserError('Invalid brand template values.')
    const state = this.get(owner),
      existing = state.templates.find(item => item.name === value.name),
      template = {
        ...value,
        accent: value.accent.toUpperCase(),
        revision: (existing?.revision ?? 0) + 1
      }
    state.templates = [
      ...state.templates.filter(item => item.name !== value.name),
      template
    ]
    this.save(owner, state)
    return template
  }
  removeTemplate(owner: string, name: string): void {
    this.template(owner, name)
    const state = this.get(owner)
    state.templates = state.templates.filter(item => item.name !== name)
    this.save(owner, state)
  }
  stage(
    owner: string,
    scope: {
      thread: string
      project: string | null
      sourceRevision: string | undefined
    },
    kind: SuitePending['kind'],
    payload: unknown
  ): SuitePending {
    const state = this.get(owner),
      pending: SuitePending = {
        ...scope,
        kind,
        token: newId(),
        revision: 1,
        expiresAt: this.now() + 600000,
        payload: JSON.stringify(payload)
      }
    state.pending = pending
    this.save(owner, state)
    return pending
  }
  pending(
    owner: string,
    scope: {
      thread: string
      project: string | null
      sourceRevision: string | undefined
    },
    token: string,
    revision: number
  ): SuitePending {
    const pending = this.get(owner).pending
    if (
      !pending ||
      pending.token !== token ||
      pending.revision !== revision ||
      pending.thread !== scope.thread ||
      pending.project !== scope.project ||
      pending.sourceRevision !== scope.sourceRevision
    )
      throw new UserError(
        'Preview expired or changed. Open a fresh source review.'
      )
    return pending
  }
  replacePending(
    owner: string,
    scope: {
      thread: string
      project: string | null
      sourceRevision: string | undefined
    },
    token: string,
    revision: number,
    payload: unknown
  ): SuitePending {
    const pending = this.pending(owner, scope, token, revision),
      state = this.get(owner)
    pending.revision++
    pending.payload = JSON.stringify(payload)
    pending.expiresAt = this.now() + 600000
    state.pending = pending
    this.save(owner, state)
    return pending
  }
  takePending(
    owner: string,
    scope: {
      thread: string
      project: string | null
      sourceRevision: string | undefined
    },
    token: string,
    revision: number,
    kind: SuitePending['kind']
  ): SuitePending {
    const pending = this.pending(owner, scope, token, revision)
    if (pending.kind !== kind)
      throw new UserError('Preview has a different action type.')
    const state = this.get(owner)
    state.pending = null
    this.save(owner, state)
    return pending
  }
  record(owner: string, id: string, kind?: RecordKind): SuiteRecord {
    const record = this.get(owner).records.find(item => item.id === id)
    if (!record || (kind && record.kind !== kind))
      throw new UserError('Record not found in this private workspace.')
    return record
  }
  private validateRecord(
    value: Omit<SuiteRecord, 'id' | 'revision' | 'createdAt' | 'history'>
  ): void {
    if (
      ![
        'decision',
        'commitment',
        'trip',
        'course',
        'rehearsal',
        'form'
      ].includes(value.kind) ||
      !value.title.trim() ||
      value.title.length > 100 ||
      value.rows.length > 100 ||
      value.sources.length > 20 ||
      value.sources.some(
        source =>
          !source.text.trim() ||
          source.text.length > 12000 ||
          source.title.length > 200
      )
    )
      throw new UserError('Record exceeds its content or source limits.')
    suiteStrings(value.fields)
    for (const row of value.rows) {
      if (
        Object.values(row).some(
          text => text !== null && typeof text !== 'string'
        )
      )
        throw new UserError('Record row values must be text or null.')
      suiteStrings(
        Object.fromEntries(
          Object.entries(row).map(([key, text]) => [key, text ?? ''])
        )
      )
    }
  }
  putRecord(
    owner: string,
    value: Omit<SuiteRecord, 'id' | 'revision' | 'createdAt' | 'history'>,
    existingId?: string
  ): SuiteRecord {
    this.validateRecord(value)
    const state = this.get(owner),
      existing = existingId
        ? state.records.find(item => item.id === existingId)
        : undefined
    if (existingId && (!existing || existing.kind !== value.kind))
      throw new UserError(
        'Original record no longer exists or has a different type.'
      )
    const record: SuiteRecord = {
      ...value,
      id: existing?.id ?? newId(),
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? this.now(),
      history: existing
        ? [
            ...existing.history,
            {
              at: this.now(),
              label: `Revision ${existing.revision}`,
              rows: existing.rows
            }
          ].slice(-10)
        : []
    }
    state.records = [
      ...state.records.filter(item => item.id !== record.id),
      record
    ]
    this.save(owner, state)
    return structuredClone(record)
  }
  confirmRecord(
    owner: string,
    scope: {
      thread: string
      project: string | null
      sourceRevision: string | undefined
    },
    token: string,
    revision: number
  ): SuiteRecord {
    const pending = this.pending(owner, scope, token, revision)
    if (pending.kind !== 'record')
      throw new UserError('Choose a record preview.')
    const payload = JSON.parse(pending.payload) as {
      record: Omit<SuiteRecord, 'id' | 'revision' | 'createdAt' | 'history'>
      existing: string | null
      expectedRevision: number | null
    }
    this.validateRecord(payload.record)
    const state = this.get(owner),
      existing = payload.existing
        ? state.records.find(item => item.id === payload.existing)
        : undefined
    if (
      payload.existing &&
      (!existing ||
        existing.kind !== payload.record.kind ||
        existing.revision !== payload.expectedRevision)
    )
      throw new UserError('The original record changed or was removed.')
    const record: SuiteRecord = {
      ...payload.record,
      id: existing?.id ?? newId(),
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? this.now(),
      history: existing
        ? [
            ...existing.history,
            {
              at: this.now(),
              label: `Revision ${existing.revision}`,
              rows: existing.rows
            }
          ].slice(-10)
        : []
    }
    state.records = [
      ...state.records.filter(item => item.id !== record.id),
      record
    ]
    state.pending = null
    this.save(owner, state)
    return structuredClone(record)
  }
  removeRecord(owner: string, id: string): void {
    this.record(owner, id)
    const state = this.get(owner)
    state.records = state.records.filter(item => item.id !== id)
    if (state.listening?.record === id) state.listening = null
    this.save(owner, state)
  }
  answerField(
    owner: string,
    id: string,
    key: string,
    value: string
  ): SuiteRecord {
    const record = this.record(owner, id, 'form')
    if (!value.trim() || value.length > 2000)
      throw new UserError('Use a field value of 1..2000 characters.')
    const row = record.rows.find(row => row.field === key)
    if (!row) throw new UserError('Form field not found.')
    row.value = value
    row.confirmed = 'yes'
    return this.putRecord(owner, record, id)
  }
  listen(
    owner: string,
    thread: string,
    kind: 'learn' | 'rehearse' | 'form',
    recordId: string
  ): void {
    const record = this.record(
      owner,
      recordId,
      kind === 'learn' ? 'course' : kind === 'form' ? 'form' : 'rehearsal'
    )
    if (record.thread !== thread)
      throw new UserError('Select the session source conversation first.')
    const state = this.get(owner)
    state.listening = {
      thread,
      kind,
      record: recordId,
      expiresAt: this.now() + 600000
    }
    this.save(owner, state)
  }
  listener(owner: string, thread: string): SuiteState['listening'] {
    const state = this.get(owner)
    if (!state.listening || state.listening.thread !== thread) return null
    return state.listening
  }
  clearListener(owner: string): void {
    const state = this.get(owner)
    state.listening = null
    this.save(owner, state)
  }
  saveRecipe(
    owner: string,
    name: string,
    goal: string,
    steps: RecipeStep[]
  ): Recipe {
    suiteName(name)
    if (
      !goal.trim() ||
      goal.length > this.config.maxInputCharacters ||
      !steps.length ||
      steps.length > 10 ||
      steps.some(
        step =>
          ![
            'compose',
            'search',
            'analysis',
            'connection',
            'media',
            'local'
          ].includes(step.kind) ||
          !step.title.trim() ||
          step.title.length > 100 ||
          !step.prompt.trim() ||
          step.prompt.length > 2000 ||
          (step.kind === 'connection' &&
            !this.config.workbench.connections.some(
              connection =>
                connection.owner === Number(owner.split(':')[0]) &&
                connection.id === step.connection
            ))
      )
    )
      throw new UserError(
        'Recipe steps, instructions or connections exceed the allowed scope.'
      )
    const state = this.get(owner),
      previous = state.recipes.find(recipe => recipe.name === name),
      recipe: Recipe = {
        name,
        revision: (previous?.revision ?? 0) + 1,
        goal,
        steps: structuredClone(steps),
        history: previous
          ? [
              ...previous.history,
              {
                revision: previous.revision,
                goal: previous.goal,
                steps: previous.steps
              }
            ].slice(-5)
          : []
      }
    state.recipes = [
      ...state.recipes.filter(item => item.name !== name),
      recipe
    ]
    this.save(owner, state)
    return recipe
  }
  recipe(owner: string, name: string): Recipe {
    const recipe = this.get(owner).recipes.find(item => item.name === name)
    if (!recipe) throw new UserError('Workflow recipe not found.')
    return recipe
  }
  removeRecipe(owner: string, name: string): void {
    this.recipe(owner, name)
    const state = this.get(owner)
    state.recipes = state.recipes.filter(item => item.name !== name)
    this.save(owner, state)
  }
  renderRecipe(
    owner: string,
    name: string,
    variables: Record<string, string>
  ): { goal: string; steps: RecipeStep[] } {
    suiteStrings(variables, 2000)
    const recipe = this.recipe(owner, name),
      required = new Set(
        [
          ...JSON.stringify({
            goal: recipe.goal,
            steps: recipe.steps.map(step => ({
              title: step.title,
              prompt: step.prompt
            }))
          }).matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_-]{0,39})\}\}/g)
        ].map(match => match[1]!)
      )
    if (
      Object.keys(variables).some(key => !required.has(key)) ||
      [...required].some(key => !Object.hasOwn(variables, key))
    )
      throw new UserError(
        `Supply exactly these variables: ${[...required].join(', ') || '(none)'}.`
      )
    const replace = (text: string) =>
      text.replace(
        /\{\{([a-zA-Z][a-zA-Z0-9_-]{0,39})\}\}/g,
        (_raw, key: string) => variables[key]!
      )
    return {
      goal: replace(recipe.goal),
      steps: recipe.steps.map(step => ({
        ...step,
        title: replace(step.title),
        prompt: replace(step.prompt)
      }))
    }
  }
}
