// Which of the Crownlands' visual layers are drawn right now (Step 85c). The elevated water, the sky falls and the floating islands are the plateau's secret: they are NOT drawn while this
// screen's cloud lid is drawn (the marsh and the boat keep the secret) and are drawn when the lid is off. The cliff falls (rim, sea) are part of the cliff and are always drawn.
//
//   crownLayers.setLid(on)    called by the cloud lid (duskAtmosphere.lid) whenever it is switched; the layers follow it
//   crownLayers.force(v)      debug: true / false pins the layers on / off, null returns to the lid rule        crownLayers.visible   the current answer
//   crownLayers.attach(api) / detach(api)   the CURRENT crown visuals ({ setLayers(on) }); a rebuild attaches the new ones at the same state
//   crownLayers.attachExtra(api) / detachExtra(api)   more layers that follow the same rule (Step 85d: the Crownlands' trees)
export const crownLayers = {
  lid: true, forced: null, current: null, extras: new Set(),
  get visible() { return this.forced === null ? !this.lid : this.forced; },
  setLid(on) { this.lid = !!on; this.apply(); return this.visible; },
  force(v = null) { this.forced = v === null ? null : !!v; this.apply(); return this.visible; },
  attach(api) { this.current = api; api.setLayers(this.visible); },
  detach(api) { if (this.current === api) this.current = null; },
  attachExtra(api) { this.extras.add(api); api.setLayers(this.visible); },
  detachExtra(api) { this.extras.delete(api); },
  apply() { if (this.current) this.current.setLayers(this.visible); for (const e of this.extras) e.setLayers(this.visible); },
};
