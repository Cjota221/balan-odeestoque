import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page  = searchParams.get('page')  || '1'
  const limit = searchParams.get('limit') || '100'

  const token   = process.env.FACILZAP_API_TOKEN
  const empresa = process.env.FACILZAP_EMPRESA

  if (!token || !empresa) {
    return NextResponse.json(
      { error: true, message: 'FACILZAP_API_TOKEN ou FACILZAP_EMPRESA não configurados nas variáveis de ambiente.' },
      { status: 500 }
    )
  }

  try {
    const url = `https://api.facilzap.com.br/v1/${empresa}/produtos?page=${page}&limit=${limit}`
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(20000)
    })

    const data = await resp.json()
    return NextResponse.json(data, { status: resp.status })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Erro desconhecido'
    return NextResponse.json(
      { error: true, message },
      { status: 500 }
    )
  }
}
