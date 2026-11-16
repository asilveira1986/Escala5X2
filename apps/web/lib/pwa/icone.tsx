/** Ícone provisório (a marca definitiva fica para depois): as cinco barras da semana, uma delas em destaque. */
export function iconeJornada(px: number, mascara: boolean) {
  const logo = Math.round(px * (mascara ? 0.56 : 0.78));            // ícone "maskable" precisa de margem de segurança (~20%)
  const largura = Math.round(logo * 0.0875), passo = Math.round(logo * 0.15);
  const alto = Math.round(logo * 0.4375), raio = Math.round(logo * 0.05);
  return (
    <div style={{ width: px, height: px, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f6b63', borderRadius: mascara ? 0 : Math.round(px * 0.22) }}>
      <div style={{ width: logo, height: alto, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: passo - largura }}>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} style={{ width: largura, height: alto, borderRadius: raio, background: '#ffffff', opacity: 0.92 }} />)}
        <div style={{ width: largura, height: alto, borderRadius: raio, background: '#f2c230' }} />
      </div>
    </div>
  );
}

