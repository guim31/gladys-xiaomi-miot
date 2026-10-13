// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// On, mode, speed, target humidity... are already Gladys scene actions on the
// translated features. This one reaches what the translation leaves out: any
// writable MIoT property of the device (the buzzer, the display, the LED, a
// vendor setting), by its `<siid>.<piid>` as miot-spec.org lists it. The
// diagnosis action names the services left out.
//
// The trigger (`maintenance_needed`) is fired by the hub from the readings,
// never as a consequence of this action: a scene bound to it would loop.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async set_property(hub, { fields }) {
    const raw = await hub.setProperty(fields.device, fields.property, fields.value);
    return { value: typeof raw === 'string' ? raw : JSON.stringify(raw) };
  },
};
