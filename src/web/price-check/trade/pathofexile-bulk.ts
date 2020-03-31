import { MainProcess } from '@/ipc/main-process-bindings'
import { Leagues } from '../Leagues'
import { SearchResult, Account, getTradeEndpoint, SEARCH_LIMIT, FETCH_LIMIT } from './common'
import { RateLimiter } from './RateLimiter'

interface TradeRequest { /* eslint-disable camelcase */
  exchange: {
    status: { option: 'online' }
    have: string[]
    want: string[]
    minimum?: number
    fulfillable?: null
  }
}

interface FetchResult {
  id: string
  listing: {
    indexed: string
    price: {
      exchange: {
        amount: number
      }
      item: {
        amount: number
        stock: number
      }
    }
    account: Account
  }
}

interface PricingResult {
  id: string
  listedAt: string
  exchangeAmount: number
  itemAmount: number
  stock: number
  accountStatus: 'offline' | 'online' | 'afk'
  accountName: string
  ign: string
}

async function requestTradeResultList (body: TradeRequest) {
  await RateLimiter.waitMulti(SEARCH_LIMIT)

  const response = await fetch(`${MainProcess.CORS}https://${getTradeEndpoint()}/api/trade/exchange/${Leagues.selected}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const data: SearchResult = await response.json()
  if (data.error) {
    throw new Error(data.error.message)
  }

  return data
}

async function requestResults (queryId: string, resultIds: string[]): Promise<PricingResult[]> {
  await RateLimiter.waitMulti(FETCH_LIMIT)

  const response = await fetch(`https://${getTradeEndpoint()}/api/trade/fetch/${resultIds.join(',')}?query=${queryId}&exchange`)
  const data: { result: FetchResult[], error: SearchResult['error'] } = await response.json()
  if (data.error) {
    throw new Error(data.error.message)
  }

  return data.result
    .filter(result => result != null) // { gone: true }
    .map(result => {
      return {
        id: result.id,
        listedAt: result.listing.indexed,
        exchangeAmount: result.listing.price.exchange.amount,
        itemAmount: result.listing.price.item.amount,
        stock: result.listing.price.item.stock,
        ign: result.listing.account.lastCharacterName,
        accountName: result.listing.account.name,
        accountStatus: result.listing.account.online
          ? (result.listing.account.online.status === 'afk' ? 'afk' : 'online')
          : 'offline'
      } as PricingResult
    })
}

interface BulkSearch {
  exa: {
    queryId: string
    total: number
    listed: PricingResult[]
  }
  chaos: {
    queryId: string
    total: number
    listed: PricingResult[]
  }
}

const HAVE_CURRENCY = ['exa', 'chaos']

export async function execBulkSearch (want: string): Promise<BulkSearch> {
  const resultByHave = await Promise.all(HAVE_CURRENCY.map(async (have) => {
    const query = await requestTradeResultList({
      exchange: {
        have: [have],
        want: [want],
        status: { option: 'online' }
        // fulfillable: null
      }
    })

    return {
      queryId: query.id,
      total: query.total,
      listed: (query.total > 0)
        ? await requestResults(query.id, query.result.slice(0, 20))
        : []
    }
  }))

  return {
    exa: resultByHave[0],
    chaos: resultByHave[1]
  }
}
