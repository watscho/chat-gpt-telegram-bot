import type { Config } from '../config.js'
import { UserError } from '../domain/conversation.js'
import type { StateStore } from '../domain/state.js'
import type { Usage, UsageKind } from '../domain/workspace.js'
import { Workspaces } from './workspaces.js'

export class UsageLedger {
  private readonly local = new Map<string, Usage>()
  constructor(
    private readonly config: Config,
    private readonly workspaces: Workspaces,
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  get(owner: string): Usage {
    // Quota accounting uses UTC so timezone changes cannot reopen the day's allowance.
    const day = new Date(this.now()).toISOString().slice(0, 10)
    const saved =
      this.local.get(owner) ?? this.store?.getRecord<Usage>('usage', owner)
    return saved?.day === day
      ? structuredClone(saved)
      : {
          day,
          requests: 0,
          estimatedMicroUsd: 0,
          images: 0,
          searches: 0,
          voice: 0,
          transcriptions: 0,
          failed: 0
        }
  }
  private save(owner: string, usage: Usage): void {
    this.store?.putRecord('usage', owner, usage)
    this.local.set(owner, usage)
  }
  reserve(
    owner: string,
    kind: UsageKind,
    allowImages = true,
    projectId?: string | null,
    extraEstimate = 0
  ): {
    options: {
      enableImages: boolean
      enableSearch: boolean
      maxToolCalls: number
    }
    finish: (actual?: { images: number; searches: number }) => void
    fail: () => void
  } {
    if (!Number.isSafeInteger(extraEstimate) || extraEstimate < 0)
      throw new UserError('Invalid operation estimate.')
    const usage = this.get(owner)
    const settings = this.workspaces.get(owner)
    const project = projectId
      ? settings.projects.find(item => item.id === projectId)
      : undefined
    if (projectId && !project)
      throw new UserError(
        'The origin project no longer exists. Requeue work in an existing project or without one.'
      )
    const projectUsage = projectId
      ? (usage.projects?.[projectId] ?? {
          requests: 0,
          estimatedMicroUsd: 0,
          images: 0,
          searches: 0,
          voice: 0,
          transcriptions: 0,
          failed: 0
        })
      : undefined
    const projectRemaining = project
      ? (project.dailyBudget ?? this.config.dailyBudgetMicroUsd) -
        projectUsage!.estimatedMicroUsd
      : Infinity
    const remainingMoney = Math.min(
      projectRemaining,
      (settings.budget ?? this.config.dailyBudgetMicroUsd) -
        usage.estimatedMicroUsd
    )
    const remainingImages = Math.max(
      0,
      (settings.imageLimit ?? this.config.dailyImages) - usage.images
    )
    const remainingSearches = Math.max(
      0,
      (settings.searchLimit ?? this.config.dailySearches) - usage.searches
    )
    const base =
      kind === 'voice'
        ? this.config.estimateVoice
        : kind === 'transcription'
          ? this.config.estimateTranscription
          : this.config.estimateChat
    let enableImages =
      kind === 'image' ||
      (kind === 'auto' && allowImages && remainingImages > 0)
    let enableSearch =
      kind === 'search' || (kind === 'auto' && remainingSearches > 0)
    if (
      kind === 'auto' &&
      base +
        this.config.estimateImage +
        (enableSearch ? this.config.estimateSearch : 0) >
        remainingMoney
    )
      enableImages = false
    if (kind === 'auto' && base + this.config.estimateSearch > remainingMoney)
      enableSearch = false
    let toolCalls = kind === 'image' ? 1 : this.config.maxWebSearchCalls
    if (kind === 'auto') {
      if (enableImages) toolCalls = Math.min(toolCalls, remainingImages)
      if (enableSearch) toolCalls = Math.min(toolCalls, remainingSearches)
      const rate =
        (enableImages ? this.config.estimateImage : 0) +
        (enableSearch ? this.config.estimateSearch : 0)
      if (rate)
        toolCalls = Math.min(
          toolCalls,
          Math.floor((remainingMoney - base) / rate)
        )
    } else if (kind === 'search')
      toolCalls = Math.min(toolCalls, remainingSearches)
    if (
      (kind === 'image' && remainingImages < 1) ||
      (kind === 'search' && toolCalls < 1)
    )
      throw new UserError(
        'Daily feature limit reached. Use /usage and /limits.'
      )
    const images = enableImages ? toolCalls : 0
    const searches = enableSearch ? toolCalls : 0
    const voice = kind === 'voice' ? 1 : 0
    const transcriptions = kind === 'transcription' ? 1 : 0
    const estimate =
      base +
      extraEstimate +
      images * this.config.estimateImage +
      searches * this.config.estimateSearch
    if (
      (projectUsage !== undefined && estimate > projectRemaining) ||
      usage.requests >= this.config.dailyRequests ||
      usage.estimatedMicroUsd + estimate >
        (settings.budget ?? this.config.dailyBudgetMicroUsd) ||
      usage.images + images >
        (settings.imageLimit ?? this.config.dailyImages) ||
      usage.searches + searches >
        (settings.searchLimit ?? this.config.dailySearches) ||
      usage.voice + voice > (settings.voiceLimit ?? this.config.dailyVoice)
    )
      throw new UserError(
        'Daily budget or feature limit reached. Use /usage and /limits.'
      )
    usage.requests++
    usage.estimatedMicroUsd += estimate
    usage.images += images
    usage.searches += searches
    usage.voice += voice
    usage.transcriptions += transcriptions
    if (projectUsage && projectId) {
      projectUsage.requests++
      projectUsage.estimatedMicroUsd += estimate
      projectUsage.images += images
      projectUsage.searches += searches
      projectUsage.voice += voice
      projectUsage.transcriptions += transcriptions
      usage.projects = { ...usage.projects, [projectId]: projectUsage }
    }
    this.save(owner, usage)
    let settled = false
    return {
      options: {
        enableImages,
        enableSearch,
        maxToolCalls: Math.max(1, toolCalls)
      },
      finish: actual => {
        if (settled) return
        settled = true
        if (!actual) return
        const current = this.get(owner)
        if (current.day !== usage.day) return
        const usedImages = Math.max(0, Math.min(images, actual.images))
        const usedSearches = Math.max(0, Math.min(searches, actual.searches))
        current.estimatedMicroUsd -=
          (images - usedImages) * this.config.estimateImage +
          (searches - usedSearches) * this.config.estimateSearch
        current.images -= images - usedImages
        current.searches -= searches - usedSearches
        if (projectId && current.projects?.[projectId]) {
          const entry = current.projects[projectId]
          entry.estimatedMicroUsd -=
            (images - usedImages) * this.config.estimateImage +
            (searches - usedSearches) * this.config.estimateSearch
          entry.images -= images - usedImages
          entry.searches -= searches - usedSearches
        }
        this.save(owner, current)
      },
      fail: () => {
        if (settled) return
        settled = true
        const current = this.get(owner)
        if (current.day !== usage.day) return
        current.failed++
        if (projectId && current.projects?.[projectId])
          current.projects[projectId].failed++
        this.save(owner, current)
      }
    }
  }
  projectReport(owner: string, id: string): string {
    const project = this.workspaces
      .get(owner)
      .projects.find(item => item.id === id)
    if (!project) throw new UserError('Select an existing project first.')
    const usage = this.get(owner),
      entry = usage.projects?.[id]
    return `Project ${id}: ${project.title}\nUTC day: ${usage.day}\nRequests: ${entry?.requests ?? 0}\nEstimated spend: $${((entry?.estimatedMicroUsd ?? 0) / 1000000).toFixed(6)}\nEffective estimated-spend ceiling: $${(Math.min(project.dailyBudget ?? this.config.dailyBudgetMicroUsd, this.workspaces.get(owner).budget ?? this.config.dailyBudgetMicroUsd) / 1000000).toFixed(6)}\nImages: ${entry?.images ?? 0}; searches: ${entry?.searches ?? 0}; voice: ${entry?.voice ?? 0}; transcriptions: ${entry?.transcriptions ?? 0}; failed: ${entry?.failed ?? 0}\nOwner quotas remain authoritative; these are configured estimates, not invoices.`
  }
  report(owner: string): string {
    const usage = this.get(owner)
    return `UTC day: ${usage.day}\nRequests: ${usage.requests}/${this.config.dailyRequests}\nEstimated spend: $${(usage.estimatedMicroUsd / 1000000).toFixed(4)}\nImage calls: ${usage.images}\nSearch calls: ${usage.searches}\nVoice replies: ${usage.voice}\nTranscriptions: ${usage.transcriptions}\nFailed/uncertain attempts: ${usage.failed}\nEstimates use operator-configured rates, not provider billing. Pending/failed attempts retain conservative reservations.`
  }
}
