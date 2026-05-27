"use client";

/**
 * Wrap a meaningful UI region so feedback submissions know it was on screen.
 *
 *   <FeedbackRegion name="composition.actual">
 *     ...
 *   </FeedbackRegion>
 *
 * The region's `name` shows up in `focus.visibleRegions` when the user's
 * viewport includes ≥40% of it at submit time. Reviewers (and Claude) see at
 * a glance which named section the user was looking at — far cheaper than a
 * screenshot, more stable than a CSS selector. Free if no <FeedbackRegion>s
 * are present.
 */

import { useEffect, useRef } from "react";
import { registerRegion } from "./focus";

export function FeedbackRegion({
  name,
  as: Tag = "div",
  className,
  children,
}: {
  name: string;
  /** Element to render as; defaults to a transparent <div>. */
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerRegion(el, name);
  }, [name]);
  const Comp = Tag as React.ElementType;
  return (
    <Comp ref={ref} className={className}>
      {children}
    </Comp>
  );
}
