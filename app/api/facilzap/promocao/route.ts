import { NextResponse } from 'next/server'

type PromocaoItem = {
  id: string
  catalogoId: number
  precoPromocional: number
  variacoes?: Array<{
    id: number
    precoPromocional: number
  }>
  dataInicio?: string
  dataTermino?: string
}

type PromocaoBody = {
  itens?: PromocaoItem[]
}

function isPromocaoItem(value: unknown): value is PromocaoItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    (typeof item.id === 'string' || typeof item.id === 'number') &&
    typeof item.catalogoId === 'number' &&
    typeof item.precoPromocional === 'number' &&
    Number.isFinite(item.precoPromocional) &&
    item.precoPromocional > 0
  )
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function montarPayload(item: PromocaoItem) {
  const cronograma = {
    data_inicio: item.dataInicio || null,
    data_termino: item.dataTermino || null
  }
  const variacoes = (item.variacoes || []).filter(v =>
    v.id > 0 &&
    Number.isFinite(v.precoPromocional) &&
    v.precoPromocional > 0
  )

  return {
    campanha_promocional: true,
    tipo_regra_preco: variacoes.length > 0 ? 'variacao' : 'geral',
    catalogos: [
      {
        id: item.catalogoId,
        ativado: true,
        precos: {
          ...(variacoes.length > 0
            ? {
                variacoes: variacoes.map(v => ({
                  id: v.id,
                  ativado: true,
                  promocional: {
                    ativado: true,
                    preco: Number(v.precoPromocional.toFixed(2)),
                    cronograma
                  }
                }))
              }
            : {
                promocional: {
                  ativado: true,
                  preco: Number(item.precoPromocional.toFixed(2)),
                  cronograma
                }
              })
        }
      }
    ]
  }
}

export async function POST(req: Request) {
  const token = process.env.FACILZAP_API_TOKEN

  if (!token) {
    return NextResponse.json(
      { error: true, message: 'FACILZAP_API_TOKEN não configurado nas variáveis de ambiente.' },
      { status: 500 }
    )
  }

  const body = await req.json() as PromocaoBody
  const itens = (body.itens || []).filter(isPromocaoItem)

  if (itens.length === 0) {
    return NextResponse.json(
      { error: true, message: 'Nenhum produto válido para aplicar promoção.' },
      { status: 400 }
    )
  }

  const resultados = []

  for (const item of itens) {
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
        ok: resp.ok,
        status: resp.status,
        message: data?.message || (resp.ok ? 'Produto atualizado.' : 'Falha ao atualizar produto.')
      })
    } catch (e: unknown) {
      resultados.push({
        id: item.id,
        ok: false,
        status: 0,
        message: e instanceof Error ? e.message : 'Erro desconhecido'
      })
    }

    await sleep(900)
  }

  const atualizados = resultados.filter(r => r.ok).length

  return NextResponse.json({
    ok: atualizados === resultados.length,
    atualizados,
    falhas: resultados.length - atualizados,
    resultados
  })
}
