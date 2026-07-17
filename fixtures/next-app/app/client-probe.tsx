"use client";

import { lafetch } from "@laflabs/lafetch";

export function ClientProbe() {
  const request = lafetch.create().get("/api/probe").timeout("1s");
  return <p data-runtime="client">{request[Symbol.toStringTag]}</p>;
}
