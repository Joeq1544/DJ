const POLL_MS = 5;

/**
 * Bounded, injectable process-group termination. Verification requires both the
 * direct child to settle and an explicit group-liveness probe to prove extinction.
 */
export async function boundedTerminateProcessGroupImpl(options) {
  let directChildSettled = false;
  let helperGroupExtinct = false;
  let verificationFailed = false;

  Promise.resolve()
    .then(options.waitForExit)
    .then(
      () => { directChildSettled = true; },
      () => { verificationFailed = true; },
    );

  const signal = (value) => {
    try {
      options.signalGroup(value);
    } catch (error) {
      if (error?.code !== "ESRCH") verificationFailed = true;
    }
  };
  const probe = () => {
    try {
      helperGroupExtinct = !options.isGroupAlive();
    } catch (error) {
      if (error?.code === "ESRCH") helperGroupExtinct = true;
      else verificationFailed = true;
    }
  };
  const waitThrough = async (deadline) => {
    do {
      await Promise.resolve();
      probe();
      if (directChildSettled && helperGroupExtinct) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      await delay(Math.min(POLL_MS, remaining));
    } while (true);
  };

  signal("SIGTERM");
  await waitThrough(Date.now() + options.graceMs);
  if (!(directChildSettled && helperGroupExtinct)) {
    signal("SIGKILL");
    await waitThrough(Date.now() + options.postKillMs);
  }
  probe();
  const verified = directChildSettled && helperGroupExtinct && !verificationFailed;
  return { directChildSettled, helperGroupExtinct, verified, verificationFailed };
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
