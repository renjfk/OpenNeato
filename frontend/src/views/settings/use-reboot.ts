import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { SystemData } from "../../types";

export function useReboot(currentUptime: number) {
    const [rebooting, setRebooting] = useState(false);
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const uptimeBeforeReboot = useRef(0);

    const pollUntilRebooted = useCallback(() => {
        const poll = () => {
            fetch("/api/system")
                .then((res) => (res.ok ? res.json() : Promise.reject()))
                .then((data: SystemData) => {
                    if (data.uptime < uptimeBeforeReboot.current) {
                        window.location.reload();
                    } else {
                        pollTimer.current = setTimeout(poll, 2000);
                    }
                })
                .catch(() => {
                    pollTimer.current = setTimeout(poll, 2000);
                });
        };
        pollTimer.current = setTimeout(poll, 2000);
    }, []);

    useEffect(() => {
        return () => {
            if (pollTimer.current) clearTimeout(pollTimer.current);
        };
    }, []);

    const startRebootFlow = useCallback(() => {
        uptimeBeforeReboot.current = currentUptime;
        setRebooting(true);
        pollUntilRebooted();
    }, [currentUptime, pollUntilRebooted]);

    return { rebooting, startRebootFlow };
}
