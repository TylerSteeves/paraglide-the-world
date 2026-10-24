export type Rgb = { r: number; g: number; b: number }

export type PilotSkin = {
  id: string
  name: string
  blurb: string
  /** null means the suit is included. A price stays locked until it is earned or bought. */
  priceLabel: string | null
  suit: Rgb
  helmet: Rgb
  visor: Rgb
  boots: Rgb
  /** null keeps the wing's own color. */
  canopy: Rgb | null
}

export type Souvenir = {
  id: string
  name: string
  fromWorld: string
}

export type WorldReward = {
  skinId: string
  souvenirName: string
}

export const PILOT_SKINS: PilotSkin[] = [
  {
    id: 'slate',
    name: 'Slate',
    blurb: 'The suit you launch with.',
    priceLabel: null,
    suit: { r: 0.15, g: 0.2, b: 0.28 },
    helmet: { r: 0.98, g: 0.98, b: 1 },
    visor: { r: 0.04, g: 0.04, b: 0.06 },
    boots: { r: 0.18, g: 0.22, b: 0.32 },
    canopy: null,
  },
  {
    id: 'alpine',
    name: 'Alpine Red',
    blurb: 'Included. A high-vis mountain suit.',
    priceLabel: null,
    suit: { r: 0.72, g: 0.12, b: 0.14 },
    helmet: { r: 0.92, g: 0.93, b: 0.95 },
    visor: { r: 0.05, g: 0.08, b: 0.12 },
    boots: { r: 0.22, g: 0.08, b: 0.08 },
    canopy: { r: 0.86, g: 0.16, b: 0.18 },
  },
  {
    id: 'copacabana',
    name: 'Copacabana',
    blurb: 'Fly the Rio drop to earn this.',
    priceLabel: null,
    suit: { r: 0.05, g: 0.45, b: 0.62 },
    helmet: { r: 0.98, g: 0.82, b: 0.18 },
    visor: { r: 0.02, g: 0.12, b: 0.16 },
    boots: { r: 0.1, g: 0.28, b: 0.34 },
    canopy: { r: 0.1, g: 0.72, b: 0.78 },
  },
  {
    id: 'paris-bleu',
    name: 'Paris Bleu',
    blurb: 'Fly the Paris drop to earn this.',
    priceLabel: null,
    suit: { r: 0.12, g: 0.22, b: 0.55 },
    helmet: { r: 0.9, g: 0.91, b: 0.94 },
    visor: { r: 0.08, g: 0.1, b: 0.22 },
    boots: { r: 0.1, g: 0.12, b: 0.2 },
    canopy: { r: 0.18, g: 0.32, b: 0.72 },
  },
  {
    id: 'giza',
    name: 'Giza Sand',
    blurb: 'Fly the Egypt drop to earn this.',
    priceLabel: null,
    suit: { r: 0.72, g: 0.58, b: 0.32 },
    helmet: { r: 0.55, g: 0.32, b: 0.14 },
    visor: { r: 0.2, g: 0.1, b: 0.04 },
    boots: { r: 0.35, g: 0.22, b: 0.1 },
    canopy: { r: 0.86, g: 0.68, b: 0.28 },
  },
  {
    id: 'london-navy',
    name: 'City Navy',
    blurb: 'Fly the London drop to earn this.',
    priceLabel: null,
    suit: { r: 0.08, g: 0.12, b: 0.28 },
    helmet: { r: 0.15, g: 0.17, b: 0.22 },
    visor: { r: 0.04, g: 0.05, b: 0.08 },
    boots: { r: 0.12, g: 0.1, b: 0.1 },
    canopy: { r: 0.12, g: 0.18, b: 0.38 },
  },
  {
    id: 'cn-red',
    name: 'CN Red',
    blurb: 'Fly the Toronto drop to earn this.',
    priceLabel: null,
    suit: { r: 0.7, g: 0.1, b: 0.16 },
    helmet: { r: 0.95, g: 0.95, b: 0.96 },
    visor: { r: 0.25, g: 0.02, b: 0.04 },
    boots: { r: 0.2, g: 0.05, b: 0.06 },
    canopy: { r: 0.78, g: 0.12, b: 0.16 },
  },
  {
    id: 'roman-clay',
    name: 'Roman Clay',
    blurb: 'Fly the Rome drop to earn this.',
    priceLabel: null,
    suit: { r: 0.62, g: 0.28, b: 0.2 },
    helmet: { r: 0.78, g: 0.72, b: 0.64 },
    visor: { r: 0.18, g: 0.08, b: 0.06 },
    boots: { r: 0.32, g: 0.16, b: 0.12 },
    canopy: { r: 0.7, g: 0.32, b: 0.22 },
  },
  {
    id: 'nyc-night',
    name: 'NYC Night',
    blurb: 'Fly the Downtown New York drop to earn this.',
    priceLabel: null,
    suit: { r: 0.08, g: 0.08, b: 0.1 },
    helmet: { r: 0.1, g: 0.12, b: 0.16 },
    visor: { r: 0.15, g: 0.55, b: 0.85 },
    boots: { r: 0.06, g: 0.06, b: 0.08 },
    canopy: { r: 0.05, g: 0.08, b: 0.14 },
  },
  {
    id: 'gold-leaf',
    name: 'Gold Leaf',
    blurb: 'A paid suit. The shop is not open yet.',
    priceLabel: '$8',
    suit: { r: 0.72, g: 0.55, b: 0.16 },
    helmet: { r: 0.85, g: 0.68, b: 0.22 },
    visor: { r: 0.35, g: 0.22, b: 0.05 },
    boots: { r: 0.4, g: 0.28, b: 0.08 },
    canopy: { r: 0.92, g: 0.72, b: 0.18 },
  },
  {
    id: 'iridium',
    name: 'Iridium Pro',
    blurb: 'A paid suit. The shop is not open yet.',
    priceLabel: '$5',
    suit: { r: 0.22, g: 0.24, b: 0.3 },
    helmet: { r: 0.55, g: 0.58, b: 0.66 },
    visor: { r: 0.35, g: 0.15, b: 0.55 },
    boots: { r: 0.16, g: 0.16, b: 0.2 },
    canopy: { r: 0.45, g: 0.48, b: 0.58 },
  },
]

/** Skins you start with. City drops and future purchases add the rest. */
const STARTER_SKIN_IDS = ['slate', 'alpine']

export const WORLD_REWARDS: Record<string, WorldReward> = {
  manhattan: { skinId: 'nyc-night', souvenirName: 'Downtown NYC crest' },
  rio: { skinId: 'copacabana', souvenirName: 'Copacabana ribbon' },
  paris: { skinId: 'paris-bleu', souvenirName: 'Champ de Mars pin' },
  egypt: { skinId: 'giza', souvenirName: 'Giza scarab' },
  london: { skinId: 'london-navy', souvenirName: 'Thames token' },
  toronto: { skinId: 'cn-red', souvenirName: 'CN Tower token' },
  sf: { skinId: 'alpine', souvenirName: 'Golden Gate washer' },
  rome: { skinId: 'roman-clay', souvenirName: 'Forum coin' },
}

const OWNED_KEY = 'ptw-owned-skins'
const EQUIPPED_KEY = 'ptw-equipped-skin'
const SOUVENIR_KEY = 'ptw-souvenirs'
const COLLECTED_KEY = 'ptw-collected-drops'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export class PilotWardrobe {
  ownedIds: Set<string>
  equippedId: string
  souvenirs: Souvenir[]
  collectedWorlds: Set<string>

  constructor() {
    const owned = readJson<string[]>(OWNED_KEY, [])
    this.ownedIds = new Set([...STARTER_SKIN_IDS, ...owned])
    const equipped = readJson<string | null>(EQUIPPED_KEY, null) || 'slate'
    this.equippedId = this.ownedIds.has(equipped) ? equipped : 'slate'
    this.souvenirs = readJson<Souvenir[]>(SOUVENIR_KEY, [])
    this.collectedWorlds = new Set(readJson<string[]>(COLLECTED_KEY, []))
    this.persist()
  }

  skinById(id: string): PilotSkin | undefined {
    return PILOT_SKINS.find((skin) => skin.id === id)
  }

  equippedSkin(): PilotSkin {
    return this.skinById(this.equippedId) || PILOT_SKINS[0]
  }

  owns(id: string): boolean {
    return this.ownedIds.has(id)
  }

  /** Paid skins stay locked. Earned and included skins equip immediately. */
  equip(id: string): PilotSkin | null {
    const skin = this.skinById(id)
    if (!skin || !this.ownedIds.has(id)) return null
    this.equippedId = id
    this.persist()
    return skin
  }

  hasCollected(worldId: string): boolean {
    return this.collectedWorlds.has(worldId)
  }

  collectDrop(worldId: string): { skin: PilotSkin | null; souvenir: Souvenir | null; lockedPrice: string | null } {
    const reward = WORLD_REWARDS[worldId]
    if (!reward || this.collectedWorlds.has(worldId)) {
      return { skin: null, souvenir: null, lockedPrice: null }
    }
    this.collectedWorlds.add(worldId)
    const skin = this.skinById(reward.skinId) || null
    let granted: PilotSkin | null = null
    let lockedPrice: string | null = null
    if (skin) {
      if (skin.priceLabel && !this.ownedIds.has(skin.id)) {
        lockedPrice = skin.priceLabel
      } else if (!this.ownedIds.has(skin.id)) {
        this.ownedIds.add(skin.id)
        this.equippedId = skin.id
        granted = skin
      }
    }
    const souvenirId = `souvenir:${worldId}`
    let souvenir: Souvenir | null = null
    if (!this.souvenirs.some((item) => item.id === souvenirId)) {
      souvenir = { id: souvenirId, name: reward.souvenirName, fromWorld: worldId }
      this.souvenirs.push(souvenir)
    }
    this.persist()
    return { skin: granted, souvenir, lockedPrice }
  }

  private persist(): void {
    try {
      localStorage.setItem(OWNED_KEY, JSON.stringify([...this.ownedIds]))
      localStorage.setItem(EQUIPPED_KEY, JSON.stringify(this.equippedId))
      localStorage.setItem(SOUVENIR_KEY, JSON.stringify(this.souvenirs))
      localStorage.setItem(COLLECTED_KEY, JSON.stringify([...this.collectedWorlds]))
    } catch {
      // Private mode can block storage. The suit still applies for this session.
    }
  }
}
