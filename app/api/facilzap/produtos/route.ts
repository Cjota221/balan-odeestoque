import { NextResponse } from 'next/server'

type ApiObject = Record<string, unknown>

function getProdutoId(produto: unknown) {
  if (!produto || typeof produto !== 'object') {
    return null
  }

  const id = (produto as ApiObject).id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

async function fetchFacilZapJson(url: URL, token: string) {
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(20000)
  })

  const data = await resp.json()
  return { resp, data }
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

function toNumber(value: unknown) {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(
      value
        .replace(/[^\d,.-]/g, '')
        .replace(/\.(?=\d{3}(?:\D|$))/g, '')
        .replace(',', '.')
    )

    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function isPriceKey(key: string) {
  return key.toLowerCase().includes('preco') || key.toLowerCase().includes('valor')
}

function getPositiveNumber(obj: ApiObject, keys: string[]) {
  for (const key of keys) {
    const value = toNumber(obj[key])

    if (value > 0) {
      return value
    }
  }

  return 0
}

function extrairPrecos(obj: ApiObject) {
  const precoVenda = getPositiveNumber(obj, [
    'preco_venda',
    'preco',
    'valor_venda',
    'valor',
    'price',
    'sale_price',
    'preco_promocional',
    'preco_cheio',
    'preco_de_venda'
  ])
  const precoCusto = getPositiveNumber(obj, [
    'preco_custo',
    'custo',
    'valor_custo',
    'preco_compra',
    'cost_price',
    'preco_de_custo'
  ])

  if (precoVenda > 0 && precoCusto > 0) {
    return { preco_venda: precoVenda, preco_custo: precoCusto }
  }

  for (const key of ['valores', 'precos', 'pricing', 'prices', 'financeiro']) {
    const sub = obj[key]

    if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
      const nested = sub as ApiObject
      return {
        preco_venda: precoVenda || getPositiveNumber(nested, ['venda', 'preco', 'valor', 'price', 'sale_price']),
        preco_custo: precoCusto || getPositiveNumber(nested, ['custo', 'cost', 'cost_price', 'compra'])
      }
    }
  }

  return { preco_venda: precoVenda, preco_custo: precoCusto }
}

function mergeProdutoComDetalhe(produto: ApiObject, detalhe: ApiObject) {
  const merged = { ...produto, ...detalhe }
  const precosProduto = extrairPrecos(produto)
  const precosDetalhe = extrairPrecos(detalhe)

  if (precosProduto.preco_venda > 0 && precosDetalhe.preco_venda <= 0) {
    merged.preco_venda = precosProduto.preco_venda
  }

  if (precosProduto.preco_custo > 0 && precosDetalhe.preco_custo <= 0) {
    merged.preco_custo = precosProduto.preco_custo
  }

  for (const [key, value] of Object.entries(produto)) {
    if (!hasValue(merged[key]) || (isPriceKey(key) && toNumber(value) > 0 && toNumber(merged[key]) <= 0)) {
      merged[key] = value
    }
  }

  return merged
}

function unwrapData(data: unknown) {
  if (data && typeof data === 'object' && 'data' in data && (data as ApiObject).data) {
    return (data as ApiObject).data
  }

  if (data && typeof data === 'object' && 'produto' in data && (data as ApiObject).produto) {
    return (data as ApiObject).produto
  }

  return data
}

async function buscarDetalheProduto(id: string, token: string, empresa?: string) {
  const urls = [
    `https://api.facilzap.app.br/produtos/${id}`,
    ...(empresa ? [
      `https://api.facilzap.com.br/v1/${empresa}/produtos/${id}`,
      `https://api.facilzap.com.br/v1/${empresa}/produto/${id}`
    ] : []),
    `https://api.facilzap.com.br/produtos/${id}`
  ]

  let primeiroDetalhe: ApiObject | null = null

  for (const urlString of urls) {
    try {
      const url = new URL(urlString)
      const { resp, data } = await fetchFacilZapJson(url, token)

      if (!resp.ok) {
        continue
      }

      const detalhe = unwrapData(data)

      if (!detalhe || typeof detalhe !== 'object' || Array.isArray(detalhe)) {
        continue
      }

      const obj = detalhe as ApiObject
      primeiroDetalhe ||= obj

      if (extrairPrecos(obj).preco_venda > 0) {
        return obj
      }
    } catch {
      continue
    }
  }

  return primeiroDetalhe
}

async function carregarDetalhesProdutos(produtos: unknown[], token: string, empresa?: string) {
  const detalhes = await Promise.all(produtos.map(async produto => {
    const id = getProdutoId(produto)

    if (!id) {
      return produto
    }

    const detalhe = await buscarDetalheProduto(id, token, empresa)

    if (!detalhe) {
      return produto
    }

    return mergeProdutoComDetalhe(produto as ApiObject, detalhe)
  }))

  return detalhes
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page  = searchParams.get('page')  || '1'
  const length = searchParams.get('length') || searchParams.get('limit') || '100'

  const token = process.env.FACILZAP_API_TOKEN
  const empresa = process.env.FACILZAP_EMPRESA

  if (!token) {
    return NextResponse.json(
      { error: true, message: 'FACILZAP_API_TOKEN não configurado nas variáveis de ambiente.' },
      { status: 500 }
    )
  }

  try {
    const url = new URL('https://api.facilzap.app.br/produtos')
    url.searchParams.set('page', page)
    url.searchParams.set('length', length)

    const { resp, data } = await fetchFacilZapJson(url, token)

    if (!resp.ok) {
      return NextResponse.json(data, { status: resp.status })
    }

    if (data && typeof data === 'object' && Array.isArray((data as ApiObject).data)) {
      const produtos = await carregarDetalhesProdutos((data as ApiObject).data as unknown[], token, empresa)
      return NextResponse.json({ ...(data as ApiObject), data: produtos }, { status: resp.status })
    }

    return NextResponse.json(data, { status: resp.status })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Erro desconhecido'
    return NextResponse.json(
      { error: true, message },
      { status: 500 }
    )
  }
}
