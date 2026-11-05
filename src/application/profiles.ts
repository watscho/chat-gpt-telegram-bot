import type { Config } from '../config.js'
import { UserError } from '../domain/conversation.js'
import type { Profile, StateStore } from '../domain/state.js'

type Limits = Pick<Config, 'maxThreads' | 'maxMemories' | 'maxMemoryCharacters'>
export class Profiles {
  private readonly cache = new Map<string, Profile>()
  constructor(
    private readonly limits: Limits,
    private readonly store?: StateStore
  ) {}
  get(key: string): Profile {
    let profile = this.cache.get(key)
    if (!profile) {
      profile = this.store?.getProfile(key) ?? {
        active: '1',
        nextId: 2,
        threads: [{ id: '1', title: 'Main' }],
        memories: [],
        voice: 'off'
      }
      this.cache.set(key, profile)
    }
    return structuredClone(profile)
  }
  private save(key: string, profile: Profile): Profile {
    this.store?.putProfile(key, profile)
    this.cache.set(key, profile)
    return structuredClone(profile)
  }
  create(key: string, title: string): Profile {
    const profile = this.get(key)
    if (profile.threads.length >= this.limits.maxThreads)
      throw new UserError(
        'Conversation limit reached. Delete a conversation first.'
      )
    const id = String(profile.nextId++)
    profile.threads.push({ id, title: this.title(title || `Chat ${id}`) })
    profile.active = id
    return this.save(key, profile)
  }
  switch(key: string, id: string): Profile {
    const profile = this.get(key)
    if (!profile.threads.some(thread => thread.id === id))
      throw new UserError('Conversation not found. Use /chats.')
    profile.active = id
    return this.save(key, profile)
  }
  rename(key: string, title: string): void {
    const profile = this.get(key)
    profile.threads.find(thread => thread.id === profile.active)!.title =
      this.title(title)
    this.save(key, profile)
  }
  delete(key: string, id: string): void {
    const profile = this.get(key)
    if (!profile.threads.some(thread => thread.id === id))
      throw new UserError('Conversation not found. Use /chats.')
    if (profile.threads.length === 1)
      throw new UserError(
        'Keep at least one conversation. Use /reset to clear it.'
      )
    profile.threads = profile.threads.filter(thread => thread.id !== id)
    if (profile.active === id) profile.active = profile.threads[0]!.id
    this.save(key, profile)
  }
  remember(key: string, text: string): void {
    const note = text.trim()
    const profile = this.get(key)
    if (
      !note ||
      note.length + profile.memories.join('').length >
        this.limits.maxMemoryCharacters
    )
      throw new UserError(
        'Memory is empty or exceeds the configured character limit.'
      )
    if (profile.memories.includes(note)) return
    if (profile.memories.length >= this.limits.maxMemories)
      throw new UserError('Memory limit reached. Use /forget first.')
    profile.memories.push(note)
    this.save(key, profile)
  }
  forget(key: string, selector: string): void {
    const profile = this.get(key)
    if (selector === 'all') profile.memories = []
    else {
      const index = /^\d+$/.test(selector)
        ? Number(selector) - 1
        : profile.memories.findIndex(
            note => note.toLowerCase() === selector.toLowerCase()
          )
      if (index < 0 || index >= profile.memories.length)
        throw new UserError(
          'Memory not found. Use /memory, then /forget number or /forget all.'
        )
      profile.memories.splice(index, 1)
    }
    this.save(key, profile)
  }
  voice(key: string, mode: string): void {
    if (mode !== 'off' && mode !== 'on' && mode !== 'auto')
      throw new UserError(
        'Usage: /voice off | on | auto. Audio uses an AI-generated voice.'
      )
    const profile = this.get(key)
    profile.voice = mode
    this.save(key, profile)
  }
  forgetOwner(owner: string): void {
    this.cache.delete(owner)
  }

  private title(value: string): string {
    const title = value.trim()
    if (
      !title ||
      title.length > 80 ||
      [...title].some(character => character.charCodeAt(0) < 32)
    )
      throw new UserError(
        'Use a conversation name between 1 and 80 characters on one line.'
      )
    return title
  }
}
