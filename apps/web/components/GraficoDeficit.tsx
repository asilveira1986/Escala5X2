'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Déficit de cobertura por dia da semana (fase 2, em horas). A tabela ao lado tem os mesmos números. */
export function GraficoDeficit({ minutosPorDia }: { minutosPorDia: number[] }) {
  const dados = DIAS.map((dia, i) => ({ dia, horas: Math.round(((minutosPorDia[i] ?? 0) / 60) * 10) / 10 }));
  return (
    <div role="img" aria-label={`Déficit semanal por dia: ${dados.map((d) => `${d.dia} ${d.horas}h`).join(', ')}`} className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="dia" />
          <YAxis unit="h" width={48} />
          <Tooltip formatter={(v: number) => [`${v}h`, 'Déficit']} />
          <Bar dataKey="horas" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
