"use client";

import { useRef, type PointerEvent, type ReactNode, type RefObject } from "react";
import { X } from "./icons";

type DialogRef = RefObject<HTMLDialogElement | null>;

export function openSheet(ref: DialogRef) {
  if (ref.current && !ref.current.open) ref.current.showModal();
}

export function closeSheet(ref: DialogRef) {
  ref.current?.close();
}

/**
 * Bottom sheet on phones, centred modal from `sm` up. Built on `<dialog>`, so
 * Escape, focus trapping and the top layer come from the platform. The handle
 * drags to dismiss; a quick flick is enough.
 */
export function SheetPanel({
  ref,
  title,
  children,
  wide = false,
  onClose,
}: {
  ref: RefObject<HTMLDialogElement | null>;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  onClose?: () => void;
}) {
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const close = () => ref.current?.close();

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (ref.current) ref.current.style.transition = "none";
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const raw = e.clientY - d.y;
    d.dy = raw < 0 ? raw / 6 : raw;
    el.style.transform = `translateY(${d.dy}px)`;
  };
  const onUp = () => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el) return;
    const velocity = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > 120 || velocity > 0.5) {
      el.style.transition = "transform 200ms cubic-bezier(0.23, 1, 0.32, 1)";
      el.style.transform = "translateY(100%)";
      window.setTimeout(() => {
        el.close();
        el.style.transition = "";
        el.style.transform = "";
      }, 200);
    } else {
      el.style.transition = "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)";
      el.style.transform = "";
    }
  };

  return (
    <dialog
      ref={ref}
      className={`sheet ${wide ? "sheet-wide" : ""}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="sheet-body">
        <div
          className="flex cursor-grab touch-none justify-center pt-2.5 pb-1 sm:hidden"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-hidden
        >
          <span className="h-1.5 w-10 rounded-full bg-mist-deep" />
        </div>
        <div className="flex items-center justify-between gap-3 pt-2 pb-5 sm:pt-6">
          <h2 className="display text-[1.75rem]">{title}</h2>
          <button type="button" className="btn-secondary btn-icon -mr-1" aria-label="Close" onClick={close}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** A trigger button plus its sheet. */
export function Sheet({
  trigger,
  triggerClassName = "btn-secondary",
  triggerLabel,
  title,
  children,
  wide,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  triggerLabel?: string;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={triggerClassName} aria-label={triggerLabel} onClick={() => openSheet(ref)}>
        {trigger}
      </button>
      <SheetPanel ref={ref} title={title} wide={wide}>
        {children}
      </SheetPanel>
    </>
  );
}
