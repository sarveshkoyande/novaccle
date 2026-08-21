// One-shot flags for campaigns just created via chat's New Campaign Intake
// flow, which need an automatic continuation turn — notify_stakeholders,
// then the first Pre-planning question — without the user having to type
// anything first. Clicking "Create Campaign" is a client-side action the
// agent has no way to observe on its own; before this, the chat simply sat
// there until the user happened to send another message, which read as the
// conversation randomly stopping mid-flow. Deliberately NOT part of the
// persisted chat store: this is transient, consumed the instant the newly
// mounted ChatPanel for that campaign fires it, and never needs to survive
// a reload.
export const pendingIntakeContinuations = new Set<string>();
