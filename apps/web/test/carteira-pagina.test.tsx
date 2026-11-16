import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Casca } from '@/components/Casca';

vi.mock('next/navigation', () => ({ usePathname: () => '/empresas', useRouter: () => ({ push: vi.fn() }) }));

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('Casca: atalhos', () => {
  it('mostra Carteira só para quem gere empresas e Minha escala só para quem é colaborador', () => {
    const so = html(<Casca email="a@b.c">x</Casca>);
    expect(so).not.toContain('href="/carteira"');
    expect(so).not.toContain('href="/minha-escala"');
    const todos = html(<Casca email="a@b.c" temCarteira temMinhaEscala>x</Casca>);
    expect(todos).toContain('href="/carteira"');
    expect(todos).toContain('href="/minha-escala"');
  });
});
