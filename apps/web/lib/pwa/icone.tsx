/** Ícone do app: o símbolo da marca Jornada (anel de progresso + ponto ciano) sobre Azul Pulso. */
export function iconeJornada(px: number, mascara: boolean) {
  const logo = Math.round(px * (mascara ? 0.56 : 0.72));            // ícone "maskable" precisa de margem de segurança (~20%)
  return (
    <div style={{ width: px, height: px, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1f5eff', borderRadius: mascara ? 0 : Math.round(px * 0.22) }}>
      <svg width={logo} height={logo} viewBox="14 14 36 36">
        <circle cx="32" cy="32" r="17" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="6" />
        <path d="M32 15 A17 17 0 1 1 15 32" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
        <path d="M32 32 L32 23" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
        <circle cx="32" cy="32" r="4.5" fill="#22d3ee" />
      </svg>
    </div>
  );
}
