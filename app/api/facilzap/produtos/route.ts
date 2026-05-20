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

function mergeProdutoComDetalhe(produto: ApiObject, detalhe: ApiObject) {
  const merged = { ...produto, ...detalhe }

  for (const [key, value] of Object.entries(produto)) {
    if (!hasValue(merged[key]) || (isPriceKey(key) && toNumber(value) > 0 && toNumber(merged[key]) <= 0)) {
      merged[key] = value
    }
  }

  return merged
}

async function carregarDetalhesProdutos(produtos: unknown[], token: string) {
  const detalhes = await Promise.all(produtos.map(async produto => {
    const id = getProdutoId(produto)

    if (!id) {
      return produto
    }

    try {
      const url = new URL(`https://api.facilzap.app.br/produtos/${id}`)
      const { resp, data } = await fetchFacilZapJson(url, token)

      if (!resp.ok) {
        return produto
      }

      const detalhe = data && typeof data === 'object' && 'data' in data
        ? (data as ApiObject).data
        : data

      return detalhe && typeof detalhe === 'object'
        ? mergeProdutoComDetalhe(produto as ApiObject, detalhe as ApiObject)
        : produto
    } catch {
      return produto
    }
  }))

  return detalhes
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page  = searchParams.get('page')  || '1'
  const length = searchParams.get('length') || searchParams.get('limit') || '100'

  const token = process.env.FACILZAP_API_TOKEN

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
      const produtos = await carregarDetalhesProdutos((data as ApiObject).data as unknown[], token)
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
