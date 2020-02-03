import {
  ItemRarity,
  ItemInfluence,
  TAG_GEM_LEVEL,
  TAG_ITEM_LEVEL,
  TAG_MAP_TIER,
  TAG_RARITY,
  TAG_STACK_SIZE,
  TAG_SOCKETS,
  TAG_QUALITY,
  CORRUPTED,
  UNIDENTIFIED,
  PREFIX_VAAL,
  PREFIX_SUPERIOR,
  SUFFIX_INFLUENCE
} from './parser-constants'
import { Prophecies, ItemisedMonsters, BaseTypes } from '../data'
import { getDetailsId, nameToDetailsId } from './trends/getDetailsId'
import { ItemInfo, Prices } from './Prices'
import { ItemModifier, ModifierType, sectionToStatStrings, tryFindModifier } from './parser/modifiers'

export {
  ItemRarity,
  ItemInfluence
}

export interface ParsedItem {
  rarity: ItemRarity
  name: string
  baseType: string | undefined
  itemLevel?: number
  mapTier?: number
  quality?: number
  linkedSockets?: number // only 5 or 6
  stackSize?: number
  isUnidentified: boolean
  isCorrupted: boolean
  gemLevel?: number
  influences: ItemInfluence[]
  rawText: string
  modifiers: ItemModifier[]
  computed: {
    category?: ItemCategory
    mapName?: string
    icon?: string
    trend?: ItemInfo
  }
}

export enum ItemCategory {
  Map = 'Map',
  Prophecy = 'Prophecy',
  ItemisedMonster = 'Itemised Monster',
  Helmet = 'Helmet',
  BodyArmour = 'Body Armour',
  Gloves = 'Gloves',
  Boots = 'Boots',
  Shield = 'Shield',
  Amulet = 'Amulet',
  Belt = 'Belt',
  Ring = 'Ring',
  Flask = 'Flask',
  AbyssJewel = 'Abyss Jewel',
  Jewel = 'Jewel',
  Quiver = 'Quiver',
  Claw = 'Claw',
  Bow = 'Bow',
  Sceptre = 'Sceptre',
  Wand = 'Wand',
  FishingRod = 'Fishing Rod',
  Staff = 'Staff',
  Warstaff = 'Warstaff',
  Dagger = 'Dagger',
  RuneDagger = 'Rune Dagger',
  OneHandedAxe = 'One-Handed Axe',
  TwoHandedAxe = 'Two-Handed Axe',
  OneHandedMace = 'One-Handed Mace',
  TwoHandedMace = 'Two-Handed Mace',
  OneHandedSword = 'One-Handed Sword',
  TwoHandedSword = 'Two-Handed Sword'
}

const SECTION_PARSED = 1
const SECTION_SKIPPED = 0
const PARSER_SKIPPED = -1

interface ParserFn {
  (section: string[], item: ParsedItem):
    typeof SECTION_PARSED |
    typeof SECTION_SKIPPED |
    typeof PARSER_SKIPPED
}

interface ParserAfterHookFn {
  (item: ParsedItem): void
}

const parsers: ParserFn[] = [
  parseUnidentified,
  parseItemLevel,
  parseVaalGem,
  parseGem,
  parseStackSize,
  parseCorrupted,
  parseInfluence,
  parseMap,
  parseSockets,
  parseModifiers, // enchant
  parseModifiers, // implicit
  parseModifiers // explicit
]

const parserAfterHooks = new Map<ParserFn, ParserAfterHookFn>([
  [parseUnidentified, normalizeName]
])

export function parseClipboard (clipboard: string) {
  const lines = clipboard.split(/\s*\n/)
  lines.pop()

  let sections: string[][] = [[]]
  lines.reduce((section, line) => {
    if (line !== '--------') {
      section.push(line)
      return section
    } else {
      const section: string[] = []
      sections.push(section)
      return section
    }
  }, sections[0])
  sections = sections.filter(section => section.length)

  const parsed = parseNamePlate(sections[0])
  if (!parsed) {
    return null
  } else if (parsed.name === 'Chaos Orb') {
    // need to think how to handle it
    return null
  }
  sections.shift()

  // each section can be parsed at most by one parser
  for (const parser of parsers) {
    for (const section of sections) {
      const result = parser(section, parsed)
      if (result === SECTION_PARSED) {
        sections = sections.filter(s => s !== section)
        break
      } else if (result === PARSER_SKIPPED) {
        break
      }
    }

    const afterHook = parserAfterHooks.get(parser)
    if (afterHook) {
      afterHook(parsed)
    }
  }

  parsed.rawText = clipboard
  enrichItem(parsed)

  return Object.freeze(parsed)
}

function normalizeName (item: ParsedItem) {
  if (
    item.rarity === ItemRarity.Normal || // quality >= +1%
    item.rarity === ItemRarity.Magic || // unidentified && quality >= +1%
    item.rarity === ItemRarity.Rare || // unidentified && quality >= +1%
    item.rarity === ItemRarity.Unique // unidentified && quality >= +1%
  ) {
    if (item.name.startsWith(PREFIX_SUPERIOR)) {
      item.name = item.name.substr(PREFIX_SUPERIOR.length)
    }
  }

  if (Prophecies.has(item.name)) {
    item.computed.category = ItemCategory.Prophecy
  } else if (
    ItemisedMonsters.has(item.name) || // Unique beast
    (item.baseType && ItemisedMonsters.has(item.baseType)) // Rare beast
  ) {
    item.computed.category = ItemCategory.ItemisedMonster
  } else if (BaseTypes.has(item.baseType || item.name)) {
    item.computed.category = BaseTypes.get(item.baseType || item.name)!.category
  } else {
    // Map
    const mapName = (item.isUnidentified || item.rarity === ItemRarity.Normal)
      ? item.name
      : item.baseType

    if (mapName?.endsWith(' Map')) {
      item.computed.category = ItemCategory.Map
      item.computed.mapName = mapName
    }
  }
}

function parseMap (section: string[], item: ParsedItem) {
  if (section[0].startsWith(TAG_MAP_TIER)) {
    item.mapTier = Number(section[0].substr(TAG_MAP_TIER.length))
    return SECTION_PARSED
  }
  return SECTION_SKIPPED
}

function parseNamePlate (section: string[]) {
  if (!section[0].startsWith(TAG_RARITY)) {
    return null
  }

  const rarity = section[0].substr(TAG_RARITY.length)
  switch (rarity) {
    case ItemRarity.Currency:
    case ItemRarity.DivinationCard:
    case ItemRarity.Gem:
    case ItemRarity.Normal:
    case ItemRarity.Magic:
    case ItemRarity.Rare:
    case ItemRarity.Unique:
      const item : ParsedItem = {
        rarity,
        name: section[1].replace(/^(<<.*?>>|<.*?>)+/, ''), // Item from chat "<<set:MS>><<set:M>><<set:S>>Beast Grinder"
        baseType: section[2],
        isUnidentified: false,
        isCorrupted: false,
        modifiers: [],
        influences: [],
        computed: {},
        rawText: undefined!
      }
      return item
    default:
      return null
  }
}

function parseInfluence (section: string[], item: ParsedItem) {
  if (section[0].endsWith(SUFFIX_INFLUENCE)) {
    for (const line of section) {
      const influence = line.slice(0, -SUFFIX_INFLUENCE.length)
      switch (influence) {
        case ItemInfluence.Crusader:
        case ItemInfluence.Elder:
        case ItemInfluence.Shaper:
        case ItemInfluence.Hunter:
        case ItemInfluence.Redeemer:
        case ItemInfluence.Warlord:
          item.influences.push(influence)
      }
    }
    return SECTION_PARSED
  }
  return SECTION_SKIPPED
}

function parseCorrupted (section: string[], item: ParsedItem) {
  if (section[0] === CORRUPTED) {
    item.isCorrupted = true
    return SECTION_PARSED
  }
  return SECTION_SKIPPED
}

function parseUnidentified (section: string[], item: ParsedItem) {
  if (section[0] === UNIDENTIFIED) {
    item.isUnidentified = true
    return SECTION_PARSED
  }
  return SECTION_SKIPPED
}

function parseItemLevel (section: string[], item: ParsedItem) {
  if (section[0].startsWith(TAG_ITEM_LEVEL)) {
    item.itemLevel = Number(section[0].substr(TAG_ITEM_LEVEL.length))
    return SECTION_PARSED
  }
  return SECTION_SKIPPED
}

function parseVaalGem (section: string[], item: ParsedItem) {
  if (item.rarity !== ItemRarity.Gem) return PARSER_SKIPPED

  if (section[0] === `${PREFIX_VAAL}${item.name}`) {
    item.name = section[0]
    return SECTION_PARSED
  }
  return SECTION_SKIPPED
}

function parseGem (section: string[], item: ParsedItem) {
  if (item.rarity !== ItemRarity.Gem) {
    return PARSER_SKIPPED
  }
  if (section[1]?.startsWith(TAG_GEM_LEVEL)) {
    // "Level: 20 (Max)"
    item.gemLevel = parseInt(section[1].substr(TAG_GEM_LEVEL.length), 10)

    parseQualityNested(section, item)

    return SECTION_PARSED
  }
  return SECTION_SKIPPED
}

function parseStackSize (section: string[], item: ParsedItem) {
  if (item.rarity !== ItemRarity.Currency && item.rarity !== ItemRarity.DivinationCard) {
    return PARSER_SKIPPED
  }
  if (section[0].startsWith(TAG_STACK_SIZE)) {
    // "Stack Size: 2/9"
    item.stackSize = parseInt(section[0].substr(TAG_STACK_SIZE.length), 10)
    return SECTION_PARSED
  }
  return SECTION_SKIPPED
}

function parseSockets (section: string[], item: ParsedItem) {
  if (section[0].startsWith(TAG_SOCKETS)) {
    let sockets = section[0].substr(TAG_SOCKETS.length)
    sockets = sockets.replace(/[^ -]/g, '#')
    if (sockets === '#-#-#-#-#-#') {
      item.linkedSockets = 6
    } else if (
      sockets === '# #-#-#-#-#' ||
      sockets === '#-#-#-#-# #'
    ) {
      item.linkedSockets = 5
    }
    return SECTION_PARSED
  }
  return SECTION_SKIPPED
}

function parseQualityNested (section: string[], item: ParsedItem) {
  for (const line of section) {
    if (line.startsWith(TAG_QUALITY)) {
      // "Quality: +20% (augmented)"
      item.quality = parseInt(line.substr(TAG_QUALITY.length), 10)
      break
    }
  }
}

function parseModifiers (section: string[], item: ParsedItem) {
  if (
    item.rarity !== ItemRarity.Normal &&
    item.rarity !== ItemRarity.Magic &&
    item.rarity !== ItemRarity.Rare &&
    item.rarity !== ItemRarity.Unique
  ) {
    return PARSER_SKIPPED
  }

  const IMPLICIT_SUFFIX = ' (implicit)'
  const CRAFTED_SUFFIX = ' (crafted)'

  const countBefore = item.modifiers.length

  const statIterator = sectionToStatStrings(section)
  let stat = statIterator.next()
  while (!stat.done) {
    let modType: ModifierType | undefined
    let mod: ItemModifier | undefined

    // cleanup suffix
    if (stat.value.endsWith(IMPLICIT_SUFFIX)) {
      stat.value = stat.value.slice(0, -IMPLICIT_SUFFIX.length)
      modType = ModifierType.Implicit
    } else if (stat.value.endsWith(CRAFTED_SUFFIX)) {
      stat.value = stat.value.slice(0, -CRAFTED_SUFFIX.length)
      modType = ModifierType.Crafted
    }

    mod = tryFindModifier(stat.value)
    if (mod) {
      // @TODO: IMPORTANT! distinguish between local and global mods

      if (modType == null) {
        for (const type of mod.modInfo.types) {
          if (
            type.name !== ModifierType.Pseudo &&
            type.name !== ModifierType.Implicit &&
            type.name !== ModifierType.Crafted
          ) {
            // explicit/enchant
            modType = type.name as ModifierType
          }
        }
      }

      // @TODO tradeId handling must be out of parser responsibility
      if (mod.modInfo.types.find(type => type.name === modType)?.tradeId) {
        mod.type = modType!
        item.modifiers.push(mod)
        stat = statIterator.next(true)
      } else {
        stat = statIterator.next(false)
      }
    } else {
      stat = statIterator.next(false)
    }
  }

  if (countBefore < item.modifiers.length) {
    return SECTION_PARSED
  }
  return SECTION_SKIPPED
}

// --------

function enrichItem (item: ParsedItem) {
  const detailsId = getDetailsId(item)
  const trend = Prices.findByDetailsId(detailsId)

  item.computed.trend = trend
  item.computed.icon = trend?.icon || Prices.findByDetailsId(getIconDetailsId(item))?.icon
}

// this must be removed, since I want to depend on poe.ninja only for prices
export function getIconDetailsId (item: ParsedItem) {
  if (item.rarity === ItemRarity.Gem) {
    return nameToDetailsId(`${item.name} 20`)
  }
  if (item.computed.category === ItemCategory.Map) {
    const LATEST_MAP_VARIANT = 'Metamorph'
    return nameToDetailsId(`${item.computed.mapName} t${item.mapTier} ${LATEST_MAP_VARIANT}`)
  }
  if (item.rarity === ItemRarity.Unique) {
    return nameToDetailsId(`${item.name} ${item.baseType}`)
  }
  if (item.rarity === ItemRarity.Rare) {
    return nameToDetailsId(`${item.baseType || item.name} 82`)
  }

  return nameToDetailsId(item.baseType ? `${item.name} ${item.baseType}` : item.name)
}
