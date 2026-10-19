import { useState } from 'react';
import { Arrow } from './Icons';

/** "Build me a ___": the user names what they want, and Gemini does its best with the parts. */
export function RequestBar({ onSubmit, disabled }: { onSubmit: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const go = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSubmit(t);
    setText('');
  };
  return (
    <form className="request" onSubmit={e => { e.preventDefault(); go(); }}>
      <label htmlFor="request-input" className="request-label display">Build me a</label>
      <input
        id="request-input" className="request-input" value={text} onChange={e => setText(e.target.value)}
        placeholder="lion" maxLength={60} autoComplete="off" enterKeyHint="go" aria-describedby="request-hint"
      />
      <button className="btn primary" type="submit" disabled={!text.trim() || disabled}>Build it <Arrow /></button>
      <span id="request-hint" className="request-hint">You get three versions: one from your parts, a most accurate one, and a super-fidelity display model.</span>
    </form>
  );
}
