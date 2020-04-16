import { ParsedItem, ItemRarity } from '@/parser'
import { ItemModifier } from '@/parser/modifiers'
import { uniqueModFilterPartial } from './unique-roll'
import { rollToFilter } from './util'
import { StatFilter } from './interfaces'
import { filterPseudo } from './pseudo'
import { filterItemProp } from './pseudo/item-property'
import { getRollAsSingleNumber } from '@/parser/utils'

export interface FiltersCreationContext {
  readonly item: ParsedItem
  filters: Writeable<StatFilter>[]
  modifiers: ParsedItem['modifiers']
}

export function initUiModFilters (item: ParsedItem): StatFilter[] {
  const ctx: FiltersCreationContext = {
    item,
    filters: [],
    modifiers: [...item.modifiers]
  }

  if (item.rarity !== ItemRarity.Unique) {
    filterItemProp(ctx)
    filterPseudo(ctx)
  }

  ctx.filters.push(...ctx.modifiers.map(mod => {
    const filter: Writeable<StatFilter> = {
      tradeId: mod.stat.types.find(type => type.name === mod.type)!.tradeId,
      text: mod.stat.text, // TODO: rework
      type: mod.type,
      option: mod.option,
      roll: undefined,
      disabled: true,
      min: undefined,
      max: undefined
    }

    if (item.rarity === ItemRarity.Unique) {
      const isKnown = uniqueModFilterPartial(item, mod, filter)
      if (!isKnown) {
        itemModFilterPartial(mod, filter)
      }
    } else {
      itemModFilterPartial(mod, filter)
    }

    return filter
  }))

  return ctx.filters
}

export function itemModFilterFull (mod: ItemModifier) {
  const filter: Writeable<StatFilter> = {
    tradeId: mod.stat.types.find(type => type.name === mod.type)!.tradeId,
    text: mod.stat.text, // TODO: rework
    type: mod.type,
    option: mod.option,
    roll: undefined,
    disabled: true,
    min: undefined,
    max: undefined
  }
  itemModFilterPartial(mod, filter)
  return filter
}

function itemModFilterPartial (
  mod: ItemModifier,
  filter: Writeable<StatFilter>
) {
  if (mod.condition) {
    filter.min = mod.condition.min
    filter.max = mod.condition.max
    filter.defaultMin = filter.min
    filter.defaultMax = filter.max
    filter.roll = filter.min
  } else if (!mod.option) {
    if (mod.values) {
      if (mod.type === 'enchant') {
        filter.min = getRollAsSingleNumber(mod.values)
        filter.max = getRollAsSingleNumber(mod.values)
        filter.defaultMin = filter.min
        filter.defaultMax = filter.max
        filter.roll = filter.min
      } else {
        Object.assign(filter, rollToFilter(getRollAsSingleNumber(mod.values)))
      }
    }
  }
}
