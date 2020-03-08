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
  SUFFIX_INFLUENCE,
  IMPLICIT_SUFFIX,
  CRAFTED_SUFFIX,
  TAG_ARMOUR,
  TAG_EVASION,
  TAG_ENERGY_SHIELD,
  TAG_BLOCK_CHANCE,
  TAG_CRIT_CHANCE,
  TAG_ATTACK_SPEED,
  TAG_PHYSICAL_DAMAGE,
  TAG_ELEMENTAL_DAMAGE,
  FLASK_CHARGES,
  PREFIX_BLIGHTED,
  SECTION_SYNTHESISED,
  PREFIX_SYNTHESISED
} from './constants'
import { Prophecies, ItemisedMonsters, BaseTypes } from '../../data'
import { ItemModifier, ModifierType, sectionToStatStrings, tryFindModifier } from './modifiers'
import { ItemCategory } from './meta'
import { ParsedItem } from './ParsedItem'
import { getRollAsSingleNumber } from '../filters/util'
import { magicBasetype } from './magic-name'

const SECTION_PARSED = 1
const SECTION_SKIPPED = 0
const PARSER_SKIPPED = -1

type SectionParseResult =
  typeof SECTION_PARSED |
  typeof SECTION_SKIPPED |
  typeof PARSER_SKIPPED

interface ParserFn {
  (section: string[], item: ParsedItem): SectionParseResult
}

const parsers: ParserFn[] = [
  parseUnidentified,
  parseSynthesised,
  normalizeName,
  // -----------
  parseItemLevel,
  parseVaalGem,
  parseGem,
  parseArmour,
  parseWeapon,
  parseFlask,
  parseStackSize,
  parseCorrupted,
  parseInfluence,
  parseMap,
  parseSockets,
  parseModifiers(1),
  parseModifiers(2),
  parseModifiers(3),
  resolveStatTypes
]

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
  }

  parsed.rawText = clipboard

  return Object.freeze(parsed)
}

function normalizeName (_: string[], item: ParsedItem) {
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

  if (item.rarity === ItemRarity.Magic) {
    const baseType = magicBasetype(item.name)
    if (baseType) {
      item.name = baseType
    }
  }

  if (Prophecies.has(item.name)) {
    item.category = ItemCategory.Prophecy
  } else if (
    ItemisedMonsters.has(item.name) || // Unique beast
    (item.baseType && ItemisedMonsters.has(item.baseType)) // Rare beast
  ) {
    item.category = ItemCategory.ItemisedMonster
  } else {
    const baseType = BaseTypes.get(item.baseType || item.name)
    item.category = baseType?.category
    item.icon = baseType?.icon
  }

  return PARSER_SKIPPED as SectionParseResult // fake parser
}

function parseMap (section: string[], item: ParsedItem) {
  if (section[0].startsWith(TAG_MAP_TIER)) {
    item.props.mapTier = Number(section[0].substr(TAG_MAP_TIER.length))

    if (item.rarity === ItemRarity.Normal) {
      if (item.name.startsWith(PREFIX_BLIGHTED)) {
        item.name = item.name.substr(PREFIX_BLIGHTED.length)
        item.category = ItemCategory.Map
        item.props.mapBlighted = true
      }
    }

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
    case ItemRarity.Unique: {
      const item : ParsedItem = {
        rarity,
        name: section[1].replace(/^(<<.*?>>|<.*?>)+/, ''), // Item from chat "<<set:MS>><<set:M>><<set:S>>Beast Grinder"
        baseType: section[2]?.replace(/^(<<.*?>>|<.*?>)+/, ''),
        props: {},
        isUnidentified: false,
        isCorrupted: false,
        modifiers: [],
        influences: [],
        sockets: {},
        rawText: undefined!
      }
      return item
    }
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
          return SECTION_PARSED
      }
    }
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
    item.props.gemLevel = parseInt(section[1].substr(TAG_GEM_LEVEL.length), 10)

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

    item.sockets.white = (sockets.split('W').length - 1)

    sockets = sockets.replace(/[^ -]/g, '#')
    if (sockets === '#-#-#-#-#-#') {
      item.sockets.linked = 6
    } else if (
      sockets === '# #-#-#-#-#' ||
      sockets === '#-#-#-#-# #' ||
      sockets === '#-#-#-#-#'
    ) {
      item.sockets.linked = 5
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

function parseArmour (section: string[], item: ParsedItem) {
  let isParsed = SECTION_SKIPPED as SectionParseResult

  for (const line of section) {
    if (line.startsWith(TAG_ARMOUR)) {
      item.props.armour = parseInt(line.substr(TAG_ARMOUR.length), 10)
      isParsed = SECTION_PARSED; continue
    }
    if (line.startsWith(TAG_EVASION)) {
      item.props.evasion = parseInt(line.substr(TAG_EVASION.length), 10)
      isParsed = SECTION_PARSED; continue
    }
    if (line.startsWith(TAG_ENERGY_SHIELD)) {
      item.props.energyShield = parseInt(line.substr(TAG_ENERGY_SHIELD.length), 10)
      isParsed = SECTION_PARSED; continue
    }
    if (line.startsWith(TAG_BLOCK_CHANCE)) {
      item.props.blockChance = parseInt(line.substr(TAG_BLOCK_CHANCE.length), 10)
      isParsed = SECTION_PARSED; continue
    }
  }

  if (isParsed === SECTION_PARSED) {
    parseQualityNested(section, item)
  }

  return isParsed
}

function parseWeapon (section: string[], item: ParsedItem) {
  let isParsed = SECTION_SKIPPED as SectionParseResult

  for (const line of section) {
    if (line.startsWith(TAG_CRIT_CHANCE)) {
      item.props.critChance = parseFloat(line.substr(TAG_CRIT_CHANCE.length))
      isParsed = SECTION_PARSED; continue
    }
    if (line.startsWith(TAG_ATTACK_SPEED)) {
      item.props.attackSpeed = parseFloat(line.substr(TAG_ATTACK_SPEED.length))
      isParsed = SECTION_PARSED; continue
    }
    if (line.startsWith(TAG_PHYSICAL_DAMAGE)) {
      item.props.physicalDamage = (
        line.substr(TAG_PHYSICAL_DAMAGE.length)
          .split('-').map(str => parseInt(str, 10))
      )
      isParsed = SECTION_PARSED; continue
    }
    if (line.startsWith(TAG_ELEMENTAL_DAMAGE)) {
      item.props.elementalDamage =
        line.substr(TAG_ELEMENTAL_DAMAGE.length)
          .split(', ')
          .map(element => getRollAsSingleNumber(element.split('-').map(str => parseInt(str, 10))))
          .reduce((sum, x) => sum + x, 0)

      isParsed = SECTION_PARSED; continue
    }
  }

  if (isParsed === SECTION_PARSED) {
    parseQualityNested(section, item)
  }

  return isParsed
}

function parseModifiers (sn: number) {
  return function parseModifiers (section: string[], item: ParsedItem) {
    if (
      item.rarity !== ItemRarity.Normal &&
      item.rarity !== ItemRarity.Magic &&
      item.rarity !== ItemRarity.Rare &&
      item.rarity !== ItemRarity.Unique
    ) {
      return PARSER_SKIPPED
    }

    const countBefore = item.modifiers.length

    const statIterator = sectionToStatStrings(section)
    let stat = statIterator.next()
    while (!stat.done) {
      let modType: ModifierType | undefined

      // cleanup suffix
      if (stat.value.endsWith(IMPLICIT_SUFFIX)) {
        stat.value = stat.value.slice(0, -IMPLICIT_SUFFIX.length)
        modType = ModifierType.Implicit
      } else if (stat.value.endsWith(CRAFTED_SUFFIX)) {
        stat.value = stat.value.slice(0, -CRAFTED_SUFFIX.length)
        modType = ModifierType.Crafted
      }

      const mod = tryFindModifier(stat.value)
      if (mod) {
        if (modType == null) {
          // explicit/enchant
          const possible = mod.modInfo.types.filter(type =>
            type.name !== ModifierType.Pseudo &&
            type.name !== ModifierType.Implicit &&
            type.name !== ModifierType.Crafted
          )
          if (possible.length === 1) {
            modType = possible[0].name as ModifierType
          }
        }
        mod.source = sn

        if (
          modType == null ||
          mod.modInfo.types.find(type => type.name === modType)
        ) {
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
}

function resolveStatTypes (section: string[], item: ParsedItem) {
  // NOTE: (m.type == null) ==> (explicit OR enchant)

  const hasImplicit = item.modifiers.some(m => m.type === 'implicit')
  let hasExplicit = item.modifiers.some(m =>
    m.type === 'explicit' ||
    m.type === 'crafted' ||
    m.source === 3 ||
    (m.type == null && m.source === 2)
  )
  let hasEnchant = item.modifiers.some(m =>
    m.type === 'enchant' ||
    (hasImplicit && m.type == null && m.source === 1)
  )
  if (!hasImplicit) {
    if (
      item.modifiers.some(m => m.type == null && m.source === 1) &&
      item.modifiers.some(m => m.type == null && m.source === 2)
    ) {
      hasEnchant = true
      hasExplicit = true
    }

    if (!hasEnchant && !hasExplicit) {
      hasExplicit = true // fallback
    }
  }

  for (const mod of item.modifiers) {
    if (mod.type != null) continue

    if (mod.source === 1 && hasEnchant) {
      mod.type = 'enchant' as ModifierType
    } else {
      mod.type = 'explicit' as ModifierType
    }
  }

  return PARSER_SKIPPED as SectionParseResult
}

function parseFlask (section: string[], item: ParsedItem) {
  // the purpose of this parser is to "consume" flask buffs
  // so they are not recognized as modifiers

  for (const line of section) {
    if (FLASK_CHARGES.test(line)) {
      return SECTION_PARSED
    }
  }

  return SECTION_SKIPPED
}

function parseSynthesised (section: string[], item: ParsedItem) {
  if (section.length === 1) {
    if (section[0] === SECTION_SYNTHESISED) {
      if (item.baseType) {
        item.baseType = item.baseType.substr(PREFIX_SYNTHESISED.length)
      } else {
        item.name = item.name.substr(PREFIX_SYNTHESISED.length)
      }
      return SECTION_PARSED
    }
  }

  return SECTION_SKIPPED
}
