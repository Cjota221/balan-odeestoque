import { NextResponse } from 'next/server'

type RemoverPromocaoItem = {
  id: string
  nome?: string
  sku?: string
  catalogoId: number
  tipoRegraPreco: string
  precoAtual: number
  variacoes?: Array<{
    id: number
    precoAtual: number
  }>
}

type RemoverPromocaoBody = {
  itens?: RemoverPromocaoItem[]
}

function isRemoverPromocaoItem(value: unknown): value is RemoverPromocaoItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    (typeof item.id === 'string' || typeof item.id === 'number') &&
    typeof item.catalogoId === 'number' &&
    typeof item.tipoRegraPreco === 'string' &&
    typeof item.precoAtual === 'number' &&
    Number.isFinite(item.precoAtual) &&
    item.precoAtual > 0
  )
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function montarPayload(item: RemoverPromocaoItem) {
  const variacoes = (item.variacoes || []).filter(v =>
    v.id > 0 &&
    Number.isFinite(v.precoAtual) &&
    v.precoAtual > 0
  )

  return {
    campanha_promocional: false,
    tipo_regra_preco: variacoes.length > 0 ? 'variacao' : item.tipoRegraPreco || 'geral',
    catalogos: [
      {
        id: item.catalogoId,
        ativado: true,
        precos: {
          preco: Number(item.precoAtual.toFixed(2)),
          preco_custo: 0,
          promocional: {
            ativado: false,
            preco: 0,
            cronograma: {
              data_inicio: null,
              data_termino: null
            }
          },
          ...(variacoes.length > 0
            ? {
                variacoes: variacoes.map(v => ({
                  id: v.id,
                  ativado: true,
                  preco: Number(v.precoAtual.toFixed(2)),
                  preco_custo: {
                    ativado: false,
                    preco: 0
                  },
                  promocional: {
                    ativado: false,
                    preco: 0,
                    cronograma: {
                      data_inicio: null,
                      data_termino: null
                    }
                  }
                }))
              }
            : {})
        }
      }
    ]
  }
}

export async function POST(req: Request) {
  const token = process.env.FACILZAP_API_TOKEN

  if (!token) {
    return NextResponse.json(
      { error: true, message: 'FACILZAP_API_TOKEN nao configurado nas variaveis de ambiente.' },
      { status: 500 }
    )
  }

  const body = await req.json() as RemoverPromocaoBody
  const itens = (body.itens || []).filter(isRemoverPromocaoItem)

  if (itens.length === 0) {
    return NextResponse.json(
      { error: true, message: 'Nenhum produto valido para remover promocao.' },
      { status: 400 }
    )
  }

  const resultados = []

  for (let index = 0; index < itens.length; index++) {
    const item = itens[index]

    try {
      const resp = await fetch(`https://api.facilzap.app.br/produtos/${item.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(montarPayload(item)),
        signal: AbortSignal.timeout(20000)
      })

      const data = await resp.json().catch(() => ({}))

      resultados.push({
        id: item.id,
        nome: item.nome || '',
        sku: item.sku || '',
        ok: resp.ok,
        status: resp.status,
        message: data?.message || (resp.ok ? 'Promocao removida.' : 'Falha ao remover promocao.')
      })
    } catch (e: unknown) {
      resultados.push({
        id: item.id,
        nome: item.nome || '',
        sku: item.sku || '',
        ok: false,
        status: 0,
        message: e instanceof Error ? e.message : 'Erro desconhecido'
      })
    }

    if (index < itens.length - 1) {
      await sleep(900)
    }
  }

  const atualizados = resultados.filter(r => r.ok).length

  return NextResponse.json({
    ok: atualizados === resultados.length,
    atualizados,
    falhas: resultados.length - atualizados,
    resultados
  })
}
