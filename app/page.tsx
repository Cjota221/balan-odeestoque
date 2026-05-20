'use client'

import { Fragment, useState, useMemo, useCallback } from 'react'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Variacao {
  nome: string
  estoque: number
}

interface Produto {
  id: string
  nome: string
  sku: string
  categoria: string
  ativado: boolean
  estoqueTotal: number
  preco_custo: number
  preco_venda: number
  valor_parado: number
  variacoes: Variacao[]
}

type OrdemColuna = 'estoque' | 'preco_venda' | 'lucro' | 'lucro_total' | 'margem'
type DirecaoOrdem = 'asc' | 'desc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtN(v: number, dec = 1) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

// ─── Normalização ─────────────────────────────────────────────────────────────

type ApiObject = Record<string, unknown>

function isObject(value: unknown): value is ApiObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'string') {
    const normalized = value
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')

    const parsed = Number.parseFloat(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function getValue(source: ApiObject, paths: string[][]): unknown {
  for (const path of paths) {
    let current: unknown = source

    for (const key of path) {
      if (!isObject(current) || !(key in current)) {
        current = undefined
        break
      }

      current = current[key]
    }

    if (current !== undefined && current !== null && current !== '') {
      return current
    }
  }
}

function getNumber(source: ApiObject, paths: string[][]) {
  return toNumber(getValue(source, paths))
}

function getPositiveNumber(source: ApiObject, paths: string[][]) {
  for (const path of paths) {
    const value = toNumber(getValue(source, [path]))

    if (value > 0) {
      return value
    }
  }

  return getNumber(source, paths)
}

function getBoolean(source: ApiObject, paths: string[][], fallback = false) {
  const value = getValue(source, paths)

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value === 1
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()

    if (['true', '1', 'sim', 's', 'ativo', 'ativado', 'active', 'enabled'].includes(normalized)) {
      return true
    }

    if (['false', '0', 'nao', 'não', 'n', 'inativo', 'desativado', 'inactive', 'disabled'].includes(normalized)) {
      return false
    }
  }

  return fallback
}

function getText(source: ApiObject, paths: string[][], fallback: string) {
  const value = getValue(source, paths)

  if (Array.isArray(value)) {
    return value.filter(Boolean).join(', ') || fallback
  }

  if (isObject(value)) {
    return getText(value, [['nome'], ['name'], ['titulo'], ['descricao']], fallback)
  }

  return value === undefined || value === null || value === '' ? fallback : String(value)
}

function getArray(source: ApiObject, paths: string[][]): ApiObject[] {
  for (const path of paths) {
    const value = getValue(source, [path])

    if (Array.isArray(value)) {
      return value.filter(isObject)
    }
  }

  return []
}

function variationName(variacao: ApiObject) {
  const parts = [
    getText(variacao, [['nome'], ['name']], ''),
    getText(variacao, [['cor'], ['subgrupo', 'cor']], ''),
    getText(variacao, [['tamanho'], ['subgrupo', 'nome'], ['grupo', 'nome']], ''),
    getText(variacao, [['sku']], '')
  ].filter(Boolean)

  return [...new Set(parts)].join(' / ') || 'Variação'
}

function normalizarProdutos(lista: unknown[]): Produto[] {
  return lista.filter(isObject).map(p => {
    const variacoes = getArray(p, [['variacoes'], ['variations'], ['skus'], ['grades']])

    const variNorm: Variacao[] = variacoes.map(v => ({
      nome: variationName(v),
      estoque: getNumber(v, [
        ['estoque', 'estoque'],
        ['estoque', 'quantidade'],
        ['stock', 'quantity'],
        ['estoque'],
        ['stock'],
        ['quantidade'],
        ['qty']
      ])
    })).sort((a, b) => b.estoque - a.estoque)

    const estoqueVariacoes = variNorm.reduce((s, v) => s + v.estoque, 0)
    const estoquePrincipal = getNumber(p, [
      ['estoque', 'estoque'],
      ['estoque', 'quantidade'],
      ['stock', 'quantity'],
      ['estoque'],
      ['stock'],
      ['quantidade'],
      ['qty']
    ])
    const estoqueTotal = estoqueVariacoes > 0 ? estoqueVariacoes : estoquePrincipal

    const preco_custo = getPositiveNumber(p, [
      ['preco_custo'],
      ['valor_custo'],
      ['preco_compra'],
      ['custo'],
      ['cost_price'],
      ['valores', 'custo'],
      ['precos', 'custo']
    ])

    const preco_venda = getPositiveNumber(p, [
      ['preco_venda'],
      ['preco'],
      ['valor_venda'],
      ['valor'],
      ['price'],
      ['sale_price'],
      ['preco_promocional'],
      ['valores', 'preco'],
      ['valores', 'venda'],
      ['valores', 'valor'],
      ['precos', 'venda'],
      ['precos', 'preco']
    ])

    return {
      id: getText(p, [['id'], ['codigo']], crypto.randomUUID()),
      nome: getText(p, [['nome'], ['name'], ['titulo']], 'Sem nome'),
      sku: getText(p, [['sku'], ['codigo'], ['referencia']], '—'),
      categoria: getText(p, [['categoria_nome'], ['categoria'], ['category'], ['grupo'], ['categorias']], '—'),
      ativado: getBoolean(p, [['ativado'], ['ativo'], ['active'], ['enabled'], ['status']], false),
      estoqueTotal,
      preco_custo,
      preco_venda,
      valor_parado: estoqueTotal * preco_custo,
      variacoes: variNorm
    }
  })
}

function filtrarProdutos(produtos: Produto[], busca: string) {
  const q = busca.trim().toLowerCase()

  if (!q) {
    return produtos
  }

  return produtos.filter(p =>
    p.nome.toLowerCase().includes(q) ||
    p.sku.toLowerCase().includes(q) ||
    p.categoria.toLowerCase().includes(q)
  )
}

function EmptyInventoryIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mx-auto h-16 w-16 text-[#ed0b8c]"
      fill="none"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="10" y="16" width="44" height="36" rx="6" className="fill-pink-50 stroke-current" strokeWidth="2" />
      <path d="M18 16l5.5-7h17L46 16" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M24 30h16M24 38h10" className="stroke-current" strokeLinecap="round" strokeWidth="2" />
      <circle cx="45" cy="41" r="7" className="fill-white stroke-current" strokeWidth="2" />
      <path d="M42.5 41h5M45 38.5v5" className="stroke-current" strokeLinecap="round" strokeWidth="2" />
    </svg>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Home() {
  const [produtos, setProdutos]             = useState<Produto[]>([])
  const [loading, setLoading]               = useState(false)
  const [loadingMsg, setLoadingMsg]         = useState('')
  const [erro, setErro]                     = useState('')
  const [ultimaSync, setUltimaSync]         = useState('')
  const [busca, setBusca]                   = useState('')
  const [desconto, setDesconto]             = useState(30)
  const [custoFixo, setCustoFixo]           = useState(5.00)
  const [custoVariavel, setCustoVariavel]   = useState(2.35)
  const [ordem, setOrdem]                   = useState<OrdemColuna>('estoque')
  const [direcao, setDirecao]               = useState<DirecaoOrdem>('desc')
  const [expandido, setExpandido]           = useState<string | null>(null)

  const filtrado = useMemo(() => filtrarProdutos(produtos, busca), [produtos, busca])

  // ─── Carregamento ──────────────────────────────────────────────────────────

  const carregarEstoque = useCallback(async () => {
    setLoading(true)
    setErro('')
    setProdutos([])

    try {
      let todos: unknown[] = []
      let pagina = 1
      const limit = 100
      let temMais = true

      while (temMais) {
        setLoadingMsg(`Carregando... ${todos.length} produtos (página ${pagina})`)
        const resp = await fetch(`/api/facilzap/produtos?page=${pagina}&limit=${limit}`)
        const data = await resp.json()

        if (data.error) throw new Error(data.message)

        const lista: unknown[] = Array.isArray(data)
          ? data
          : (data.data || data.produtos || data.results || data.items || [])

        if (!Array.isArray(lista) || lista.length === 0) {
          temMais = false
        } else {
          todos = todos.concat(lista)
          if (lista.length < limit) temMais = false
          else pagina++
        }
      }

      const normalizados = normalizarProdutos(todos)
      setProdutos(normalizados)
      setUltimaSync(new Date().toLocaleString('pt-BR'))
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }, [])

  // ─── Métricas globais ─────────────────────────────────────────────────────

  const custoTotal = custoFixo + custoVariavel

  const metricas = useMemo(() => {
    const totalProdutos = produtos.length
    const totalUnidades = produtos.reduce((s, p) => s + p.estoqueTotal, 0)
    const valorEstoque  = produtos.reduce((s, p) => s + p.valor_parado, 0)
    const zerados       = produtos.filter(p => p.estoqueTotal === 0).length
    const comEstoque    = produtos.filter(p => p.estoqueTotal > 0)
    const ativosComEstoque = comEstoque.filter(p => p.ativado).length
    const desativadosComEstoque = comEstoque.filter(p => !p.ativado).length
    const produtosSemPreco = produtos.filter(p => p.estoqueTotal > 0 && p.preco_venda <= 0).length

    const faturamentoTotal = produtos.reduce((s, p) => {
      const precoPromo = p.preco_venda * (1 - desconto / 100)
      return s + p.estoqueTotal * precoPromo
    }, 0)

    const lucroTotal = produtos.reduce((s, p) => {
      const precoPromo = p.preco_venda * (1 - desconto / 100)
      return s + p.estoqueTotal * (precoPromo - custoTotal)
    }, 0)

    const precoMedio     = produtos.length > 0 ? produtos.reduce((s, p) => s + p.preco_venda, 0) / produtos.length : 0
    const precoPromoMedio = precoMedio * (1 - desconto / 100)
    const lucroMedio     = precoPromoMedio - custoTotal
    const margemMedia    = precoPromoMedio > 0 ? (lucroMedio / precoPromoMedio * 100) : 0

    return {
      totalProdutos,
      totalUnidades,
      valorEstoque,
      zerados,
      ativosComEstoque,
      desativadosComEstoque,
      produtosSemPreco,
      faturamentoTotal,
      lucroTotal,
      margemMedia,
      lucroMedio,
      precoPromoMedio
    }
  }, [produtos, desconto, custoTotal])

  // ─── Tabela ordenada ──────────────────────────────────────────────────────

  const produtosOrdenados = useMemo(() => {
    const lista = [...filtrado].map(p => {
      const precoPromo  = p.preco_venda * (1 - desconto / 100)
      const lucro       = precoPromo - custoTotal
      const margem      = precoPromo > 0 ? (lucro / precoPromo * 100) : 0
      const lucroTotalP = p.estoqueTotal * lucro
      return { ...p, precoPromo, lucro, margem, lucroTotalP }
    })

    lista.sort((a, b) => {
      const map: Record<OrdemColuna, number> = {
        estoque:     a.estoqueTotal - b.estoqueTotal,
        preco_venda: a.preco_venda  - b.preco_venda,
        lucro:       a.lucro        - b.lucro,
        lucro_total: a.lucroTotalP  - b.lucroTotalP,
        margem:      a.margem       - b.margem,
      }
      return direcao === 'desc' ? -map[ordem] : map[ordem]
    })

    return lista
  }, [filtrado, desconto, custoTotal, ordem, direcao])

  // ─── Ordenação ────────────────────────────────────────────────────────────

  function alterarOrdem(col: OrdemColuna) {
    if (ordem === col) {
      setDirecao(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setOrdem(col)
      setDirecao('desc')
    }
  }

  function iconeOrdem(col: OrdemColuna) {
    if (ordem !== col) return <span className="text-slate-400 ml-1">↕</span>
    return <span className="text-[#ed0b8c] ml-1">{direcao === 'desc' ? '↓' : '↑'}</span>
  }

  // ─── Cor da linha ─────────────────────────────────────────────────────────

  function corLinha(margem: number) {
    if (margem < 0)  return 'bg-red-50 hover:bg-red-100'
    if (margem < 15) return 'bg-amber-50 hover:bg-amber-100'
    if (margem >= 20) return 'bg-emerald-50 hover:bg-emerald-100'
    return 'hover:bg-slate-50'
  }

  function statusProduto(produto: Produto) {
    if (produto.estoqueTotal <= 0) {
      return {
        label: 'Sem estoque',
        className: 'bg-slate-100 text-slate-600 border-slate-200'
      }
    }

    if (produto.ativado) {
      return {
        label: 'Ativado',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }
    }

    return {
      label: 'Desativado',
      className: 'bg-red-50 text-red-700 border-red-200'
    }
  }

  // ─── Export CSV ───────────────────────────────────────────────────────────

  function exportarCSV() {
    const header = [
      'Posição', 'Nome', 'SKU', 'Categoria', 'Status', 'Estoque',
      'Preço atual', `Preço promo (${desconto}%)`,
      'Lucro/par', 'Margem %', 'Lucro total'
    ]

    const rows = produtosOrdenados.map((p, i) => [
      i + 1,
      p.nome,
      p.sku,
      p.categoria,
      statusProduto(p).label,
      p.estoqueTotal,
      p.preco_venda.toFixed(2).replace('.', ','),
      p.precoPromo.toFixed(2).replace('.', ','),
      p.lucro.toFixed(2).replace('.', ','),
      p.margem.toFixed(1).replace('.', ','),
      p.lucroTotalP.toFixed(2).replace('.', ','),
    ])

    const csv = [header, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\n')

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `balanco_promo${desconto}pct_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  // ─── Alerta de margem ─────────────────────────────────────────────────────

  function alertaMargem() {
    const m = metricas.margemMedia
    if (m < 0)  return { cor: 'bg-red-50 border-red-200 text-red-700',    msg: `Margem negativa (${fmtN(m)}%) — você perderia dinheiro com essa promoção.` }
    if (m < 15) return { cor: 'bg-amber-50 border-amber-200 text-amber-800', msg: `Margem baixa (${fmtN(m)}%) — avalie se vale a pena girar o estoque.` }
    if (m >= 20) return { cor: 'bg-emerald-50 border-emerald-200 text-emerald-700', msg: `Margem saudável (${fmtN(m)}%) — promoção viável.` }
    return { cor: 'bg-slate-50 border-slate-200 text-slate-700', msg: `Margem moderada (${fmtN(m)}%) — ok para girar.` }
  }

  // ─── JSX ──────────────────────────────────────────────────────────────────

  const temDados = produtos.length > 0
  const alerta   = temDados ? alertaMargem() : null

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

      {/* ── Cabeçalho ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Balanço de Estoque
            <span className="ml-2 text-[#ed0b8c]">CJ Rasteirinhas</span>
          </h1>
          {ultimaSync && (
            <p className="text-slate-500 text-sm mt-0.5">Última sync: {ultimaSync}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={carregarEstoque}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg font-semibold text-white transition-opacity disabled:opacity-60"
            style={{ backgroundColor: '#ed0b8c' }}
          >
            {loading ? loadingMsg || 'Carregando…' : 'Carregar estoque'}
          </button>

          <button
            onClick={exportarCSV}
            disabled={!temDados}
            className="px-5 py-2.5 rounded-lg font-semibold bg-slate-700 text-white transition-opacity disabled:opacity-40 hover:bg-slate-600"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      {/* ── Erro ── */}
      {erro && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          <strong>Erro:</strong> {erro}
        </div>
      )}

      {/* ── Cards de custo ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <label className="block text-slate-500 text-xs mb-1.5">Custo fixo / par</label>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-sm">R$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={custoFixo}
              onChange={e => setCustoFixo(parseFloat(e.target.value) || 0)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-950 w-full focus:outline-none focus:border-[#ed0b8c] focus:bg-white"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <label className="block text-slate-500 text-xs mb-1.5">Custo variável / par</label>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-sm">R$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={custoVariavel}
              onChange={e => setCustoVariavel(parseFloat(e.target.value) || 0)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-950 w-full focus:outline-none focus:border-[#ed0b8c] focus:bg-white"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <p className="text-slate-500 text-xs mb-1.5">Custo total / par</p>
          <p className="text-xl font-bold text-slate-950">{fmt(custoTotal)}</p>
        </div>
      </div>

      {/* ── Simulador ── */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Simulador de Promoção</h2>
          <span className="text-2xl font-bold" style={{ color: '#ed0b8c' }}>{desconto}% OFF</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-slate-500 text-sm w-6">0</span>
          <input
            type="range"
            min={0}
            max={80}
            step={1}
            value={desconto}
            onChange={e => setDesconto(Number(e.target.value))}
            className="flex-1 accent-[#ed0b8c] h-2 cursor-pointer"
          />
          <span className="text-slate-500 text-sm w-8">80%</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100">
            <p className="text-slate-500 text-xs mb-1">Preço promo médio</p>
            <p className="font-bold text-slate-950">{fmt(metricas.precoPromoMedio)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100">
            <p className="text-slate-500 text-xs mb-1">Lucro por par</p>
            <p className={`font-bold ${metricas.lucroMedio >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {fmt(metricas.lucroMedio)}
            </p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100">
            <p className="text-slate-500 text-xs mb-1">Margem na promo</p>
            <p className={`font-bold ${metricas.margemMedia >= 15 ? 'text-emerald-600' : metricas.margemMedia >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
              {fmtN(metricas.margemMedia)}%
            </p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100">
            <p className="text-slate-500 text-xs mb-1">Total unidades</p>
            <p className="font-bold text-slate-950">{metricas.totalUnidades.toLocaleString('pt-BR')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-1 bg-slate-50 rounded-xl p-5 text-center border border-slate-100">
            <p className="text-slate-500 text-sm mb-1">Valor em estoque (custo)</p>
            <p className="text-xl font-bold text-slate-700">{fmt(metricas.valorEstoque)}</p>
          </div>
          <div className="bg-[#ed0b8c] rounded-xl p-5 text-center border border-[#d30a7d]">
            <p className="text-pink-50 text-sm mb-1">Faturamento total</p>
            <p className="text-2xl font-extrabold text-white">{fmt(metricas.faturamentoTotal)}</p>
          </div>
          <div className={`rounded-xl p-5 text-center border ${metricas.lucroTotal >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <p className="text-slate-700 text-sm mb-1">Lucro total</p>
            <p className={`text-2xl font-extrabold ${metricas.lucroTotal >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {fmt(metricas.lucroTotal)}
            </p>
          </div>
        </div>

        {alerta && (
          <div className={`p-3 rounded-lg border text-sm ${alerta.cor}`}>
            {alerta.msg}
          </div>
        )}
      </div>

      {/* ── Cards gerais ── */}
      {temDados && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
            <p className="text-slate-500 text-xs mb-1">Total de produtos</p>
            <p className="text-2xl font-bold">{metricas.totalProdutos}</p>
          </div>
          <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200 shadow-sm text-center">
            <p className="text-emerald-700 text-xs mb-1">Com estoque ativados</p>
            <p className="text-2xl font-bold text-emerald-700">{metricas.ativosComEstoque}</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4 border border-red-200 shadow-sm text-center">
            <p className="text-red-700 text-xs mb-1">Com estoque desativados</p>
            <p className="text-2xl font-bold text-red-700">{metricas.desativadosComEstoque}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
            <p className="text-slate-500 text-xs mb-1">Produtos zerados</p>
            <p className={`text-2xl font-bold ${metricas.zerados > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {metricas.zerados}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
            <p className="text-slate-500 text-xs mb-1">Com estoque sem preço</p>
            <p className={`text-2xl font-bold ${metricas.produtosSemPreco > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {metricas.produtosSemPreco}
            </p>
          </div>
        </div>
      )}

      {/* ── Busca + Tabela ── */}
      {temDados && (
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Buscar por nome, SKU ou categoria…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-950 placeholder-slate-400 shadow-sm focus:outline-none focus:border-[#ed0b8c]"
          />

          <div className="text-slate-500 text-xs flex gap-4">
            <span>
              <span className="inline-block w-3 h-3 rounded-sm bg-red-100 mr-1" />vermelho = prejuízo
            </span>
            <span>
              <span className="inline-block w-3 h-3 rounded-sm bg-amber-100 mr-1" />amarelo = margem &lt; 15%
            </span>
            <span>
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-100 mr-1" />verde = margem ≥ 20%
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                  <th className="px-3 py-3 text-left w-8">#</th>
                  <th className="px-3 py-3 text-left">Produto</th>
                  <th className="px-3 py-3 text-left">Status</th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-slate-950 select-none"
                    onClick={() => alterarOrdem('estoque')}
                  >
                    Estoque {iconeOrdem('estoque')}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-slate-950 select-none"
                    onClick={() => alterarOrdem('preco_venda')}
                  >
                    Preço atual {iconeOrdem('preco_venda')}
                  </th>
                  <th className="px-3 py-3 text-right">Preço promo</th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-slate-950 select-none"
                    onClick={() => alterarOrdem('lucro')}
                  >
                    Lucro/par {iconeOrdem('lucro')}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-slate-950 select-none"
                    onClick={() => alterarOrdem('margem')}
                  >
                    Margem {iconeOrdem('margem')}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-slate-950 select-none"
                    onClick={() => alterarOrdem('lucro_total')}
                  >
                    Lucro total {iconeOrdem('lucro_total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {produtosOrdenados.map((p, i) => (
                  <Fragment key={p.id}>
                    <tr
                      className={`border-t border-slate-200 transition-colors cursor-pointer ${p.estoqueTotal > 0 && !p.ativado ? 'bg-red-50 hover:bg-red-100' : corLinha(p.margem)}`}
                      onClick={() => setExpandido(expandido === p.id ? null : p.id)}
                    >
                      <td className="px-3 py-2.5 text-slate-500 text-xs">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-950 leading-tight">{p.nome}</div>
                        <div className="text-slate-500 text-xs">{p.sku} · {p.categoria}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusProduto(p).className}`}>
                          {statusProduto(p).label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={p.estoqueTotal === 0 ? 'text-red-600 font-semibold' : 'text-slate-950'}>
                          {p.estoqueTotal}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-700">{fmt(p.preco_venda)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold" style={{ color: '#ed0b8c' }}>
                        {fmt(p.precoPromo)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${p.lucro >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmt(p.lucro)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${p.margem >= 20 ? 'text-emerald-600' : p.margem >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
                        {fmtN(p.margem)}%
                      </td>
                      <td className={`px-3 py-2.5 text-right font-bold ${p.lucroTotalP >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {fmt(p.lucroTotalP)}
                      </td>
                    </tr>

                    {expandido === p.id && p.variacoes.length > 0 && (
                      <tr key={`${p.id}-var`} className="border-t border-slate-200 bg-slate-50">
                        <td colSpan={9} className="px-6 py-3">
                          <p className="text-slate-500 text-xs font-semibold mb-2 uppercase tracking-wide">
                            Variações
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {p.variacoes.map((v, vi) => (
                              <span
                                key={vi}
                                className={`text-xs px-2.5 py-1 rounded-full border ${
                                  v.estoque === 0
                                    ? 'bg-red-50 border-red-200 text-red-700'
                                    : 'bg-white border-slate-200 text-slate-700'
                                }`}
                              >
                                {v.nome}: <strong>{v.estoque}</strong>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}

                {produtosOrdenados.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-slate-500 text-xs text-right">
            {produtosOrdenados.length} de {produtos.length} produtos · clique na linha para ver variações
          </p>
        </div>
      )}

      {/* ── Estado vazio ── */}
      {!loading && !temDados && !erro && (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-slate-500 shadow-sm">
          <EmptyInventoryIcon />
          <p className="mt-4 text-lg font-medium text-slate-700">Nenhum dado carregado</p>
          <p className="text-sm mt-1">Clique em &quot;Carregar estoque&quot; para buscar os produtos da FacilZap.</p>
        </div>
      )}
    </div>
  )
}
