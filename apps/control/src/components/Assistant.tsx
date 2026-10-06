'use client';

import { useState } from 'react';
import { SUGGESTED_QUESTIONS } from '@trust/control-core';
import { useControlStore } from '../state/useControlStore';
import { Panel, SimulatedTag } from './primitives';

export function Assistant() {
  const { aiHistory, askAi, sample } = useControlStore();
  const [input, setInput] = useState('');

  const enviar = (q: string) => {
    const texto = q.trim();
    if (!texto) return;
    askAi(texto);
    setInput('');
  };

  return (
    <div className="space-y-4">
      {/* La restricción se muestra siempre, no en un tooltip. */}
      <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
          Read only — advisory
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-400">
          <span className="font-mono text-neutral-300">
            LLM output is advisory only and cannot directly actuate building hardware.
          </span>
          <br />
          El asistente lee telemetría, estado y eventos. No puede encender ni apagar pantallas, accionar relés, cambiar
          SAFE MODE, ejecutar shows, ni enviar DMX o Modbus. No existe en el código un canal por el que una respuesta
          pueda convertirse en una acción. Tampoco tiene criterio técnico propio: todo juicio sobre si un valor está
          bien o mal sale de los umbrales configurados en <span className="font-mono">evaluateAlarms</span>.
        </p>
      </div>

      <Panel
        title="TRUST AI Assistant"
        right={
          <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
            Mock · sin LLM
          </span>
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => enviar(q)}
              className="rounded border border-neutral-800 px-2.5 py-1 text-[11px] text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="mb-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enviar(input)}
            placeholder="Preguntá sobre estado, consumo, fases o alarmas…"
            className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
          <button
            onClick={() => enviar(input)}
            disabled={!input.trim()}
            className="rounded bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-25"
          >
            Preguntar
          </button>
        </div>

        {aiHistory.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-600">
            Sin consultas todavía. El asistente responde con datos{sample?.telemetry?.simulated ? ' simulados' : ''}.
          </p>
        ) : (
          <div className="space-y-3">
            {[...aiHistory].reverse().map((item, i) => (
              <div key={i} className="rounded border border-neutral-800 bg-neutral-950/50 p-3">
                <p className="text-[12px] font-medium text-neutral-400">{item.question}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-200">{item.answer.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {item.answer.simulated && <SimulatedTag />}
                  {item.answer.usedFields.map((f) => (
                    <span key={f} className="rounded bg-neutral-800/70 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 text-[11px] leading-snug text-neutral-600">
          Las etiquetas debajo de cada respuesta indican qué campos del contexto se usaron. Cuando entre un LLM real,
          esa trazabilidad es lo que permite auditar de dónde salió una afirmación.
        </p>
      </Panel>
    </div>
  );
}
