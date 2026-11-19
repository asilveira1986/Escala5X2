import type { MetadataRoute } from 'next';

/** PWA do colaborador: abre direto na escala. Cores da identidade Jornada (Azul Pulso e fundo frio). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JornadaCerta', short_name: 'JornadaCerta', lang: 'pt-BR', dir: 'ltr',
    description: 'Sua escala, seus pedidos e seu banco de horas, no celular.',
    id: '/minha-escala', start_url: '/minha-escala', scope: '/', display: 'standalone', orientation: 'portrait',
    background_color: '#f4f6fb', theme_color: '#1f5eff', categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/512-maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Minha escala', url: '/minha-escala', icons: [{ src: '/icons/192', sizes: '192x192', type: 'image/png' }] },
      { name: 'Meus pedidos', url: '/minha-escala/pedidos', icons: [{ src: '/icons/192', sizes: '192x192', type: 'image/png' }] },
      { name: 'Meu banco de horas', url: '/minha-escala/banco-horas', icons: [{ src: '/icons/192', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
