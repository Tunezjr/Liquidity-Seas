export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    const response = await fetch('https://api.llama.fi/protocols');
    if (!response.ok) throw new Error(`DefiLlama ${response.status}`);
    const allProtocols = await response.json();

    const monadProtocols = allProtocols
      .filter((p) => p.chainTvls && p.chainTvls.Monad && p.chainTvls.Monad > 10000)
      .map((p) => ({
        id: p.id || p.slug,
        name: p.name,
        category: p.category || 'protocol',
        tvl: p.chainTvls.Monad,
        change1d: p.change_1d || 0,
      }))
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 20);

    const nodes = [];
    const edges = [];
    const now = new Date().toISOString();

    const assets = [
      { id: 'asset:monad-143:usdc', label: 'USDC', kind: 'asset' },
      { id: 'asset:monad-143:usde', label: 'USDe', kind: 'asset' },
      { id: 'asset:monad-143:ausd', label: 'AUSD', kind: 'asset' },
      { id: 'asset:monad-143:mon', label: 'MON', kind: 'asset' },
      { id: 'asset:monad-143:weth', label: 'WETH', kind: 'asset' },
    ];
    assets.forEach((a) => nodes.push(a));

    monadProtocols.forEach((proto, i) => {
      const nodeId = `entity:monad-143:${(proto.id || proto.name).toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      nodes.push({
        id: nodeId,
        kind: 'entity',
        label: `${proto.name} (~$${(proto.tvl / 1e6).toFixed(1)}M)`,
      });

      const weight = Math.round(proto.tvl / 1000);
      const targetAsset = proto.category === 'Lending' || proto.category === 'CDP' || proto.category === 'Yield'
        ? 'asset:monad-143:usdc'
        : 'asset:monad-143:mon';
      edges.push({
        id: `edge:liq:${nodeId}`,
        kind: 'flow',
        fromNodeId: nodeId,
        toNodeId: targetAsset,
        weight,
        eventId: `live:${proto.id || i}`,
      });
    });

    const payload = {
      generatedAt: now,
      snapshotId: `snapshot:live:${now.slice(0, 16)}`,
      api: {
        data: { nodes, edges },
        meta: { generatedAt: now, version: 'v1-live-defillama' },
      },
      viewModel: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        animatedEdgeIds: edges.map((e) => e.id),
      },
      events: [],
      attributions: monadProtocols.slice(0, 8).map((p) => ({
        entityId: `entity:monad-143:${(p.id || p.name).toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        assetId: 'asset:monad-143:usdc',
        inflowRaw: String(Math.round(p.tvl * 1e6)),
        outflowRaw: '0',
        netRaw: String(Math.round(p.tvl * 1e6)),
      })),
      analytics: {
        eventCount: 0,
        totalRawByAsset: { 'asset:monad-143:usdc': String(monadProtocols.reduce((s, p) => s + p.tvl, 0) * 1e6) },
      },
    };

    res.status(200).json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch live Monad liquidity', message: err.message });
  }
}
