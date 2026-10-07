"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SelectOption = { value: string; label: string; hint?: string; disabled?: boolean };

/**
 * A dropdown that looks like the rest of the shop (instead of the browser's default grey list) and still works like a real one:
 * keyboard (arrows, Home/End, Enter/Space, Esc, type a letter to jump), screen readers (listbox/option), and inside a <form>
 * (it submits `name`, and `required` shows the browser's usual "please fill in this field" message).
 */
export function ThemedSelect({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  name,
  required,
  label,
  className,
  align = "left",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  name?: string;
  required?: boolean;
  /** Accessible name when there is no visible <label>. */
  label?: string;
  className?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const selected = options.find((option) => option.value === value);
  const enabled = useMemo(() => options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0), [options]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>("button.ts-trigger")?.focus();
  }

  function move(delta: number) {
    if (!enabled.length) return;
    const position = enabled.indexOf(active);
    const next = enabled[Math.min(enabled.length - 1, Math.max(0, (position < 0 ? (delta > 0 ? -1 : enabled.length) : position) + delta))];
    setActive(next);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const now = event.timeStamp;
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(enabled[0] ?? -1);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(enabled[enabled.length - 1] ?? -1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (active >= 0) choose(active);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      typed.current = { text: now - typed.current.at > 700 ? event.key.toLowerCase() : typed.current.text + event.key.toLowerCase(), at: now };
      const hit = options.findIndex((option) => !option.disabled && option.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  }

  return (
    <div className={`ts${open ? " is-open" : ""}${className ? ` ${className}` : ""}`} ref={root} onKeyDown={onKeyDown}>
      <button type="button" className="ts-trigger" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={label} onClick={() => (open ? setOpen(false) : show())}>
        <span className={selected ? "" : "ts-placeholder"}>{selected ? selected.label : placeholder}</span>
        <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {name && <input className="ts-native" name={name} value={value} required={required} onChange={() => undefined} tabIndex={-1} aria-hidden="true" autoComplete="off" />}
      {open && (
        <ul id={`${id}-list`} className={`ts-list${align === "right" ? " ts-right" : ""}`} role="listbox" aria-label={label} ref={list}>
          {options.map((option, index) => (
            <li key={option.value} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} className={`${index === active ? "is-active" : ""}${option.value === value ? " is-selected" : ""}${option.disabled ? " is-disabled" : ""}`} onMouseMove={() => !option.disabled && index !== active && setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); choose(index); }}>
              <span>{option.label}</span>
              {option.hint && <small>{option.hint}</small>}
              {option.value === value && <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
