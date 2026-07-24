"use client";
import { useEffect, useState } from "react";

export function ProbeA() {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/x");
      const json = await res.json();
      if (!cancelled) setData(json.value);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);
  return <div>{data}</div>;
}

export function ProbeB() {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/x")
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) setData(json.value);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return <div>{data}</div>;
}
