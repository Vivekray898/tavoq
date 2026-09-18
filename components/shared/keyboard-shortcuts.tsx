"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/providers/session-provider";

/**
 * §20 — lightweight desktop shortcuts:
 *   /        → focus/open search
 *   N        → new task (admins only)
 *   G then T → Tasks
 *   G then P → Projects
 *   G then M → Payments
 *   ⌘K       → search (handled in SearchDialog)
 *
 * Ignored while typing in inputs, textareas, selects or contenteditable —
 * and when any modifier is held. A trailing hint of the pending "G" chord
 * renders in the bottom corner (desktop only) so the feature is discoverable
 * without cluttering the UI.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const { role } = useSession();
  const chordRef = useRef(false);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function armChord() {
      chordRef.current = true;
      if (chordTimer.current) clearTimeout(chordTimer.current);
      chordTimer.current = setTimeout(() => {
        chordRef.current = false;
        window.dispatchEvent(new CustomEvent("taskora-chord-end"));
      }, 1200);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable === true;

      if (chordRef.current) {
        const key = e.key.toLowerCase();
        if (key === "t") {
          e.preventDefault();
          endChord();
          router.push("/tasks");
          return;
        }
        if (key === "p") {
          e.preventDefault();
          endChord();
          router.push("/projects");
          return;
        }
        if (key === "m") {
          e.preventDefault();
          endChord();
          router.push("/payments");
          return;
        }
        endChord();
        // fall through — treat as a normal key
      }

      if (typing) return;

      if (e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("taskora-open-search"));
        return;
      }

      if (e.key.toLowerCase() === "n" && role === "ADMIN") {
        e.preventDefault();
        router.push("/tasks/new");
        return;
      }

      if (e.key.toLowerCase() === "g") {
        armChord();
      }
    }

    function endChord() {
      chordRef.current = false;
      if (chordTimer.current) clearTimeout(chordTimer.current);
      window.dispatchEvent(new CustomEvent("taskora-chord-end"));
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (chordTimer.current) clearTimeout(chordTimer.current);
    };
  }, [router, role]);

  return null;
}
