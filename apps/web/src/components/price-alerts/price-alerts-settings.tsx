"use client";

import {
  ArrowLeft,
  Bell,
  Clock,
  TrendingDown,
  TrendingUp,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAlertConfig } from "@/hooks/use-price-alerts";
import { cn } from "@/lib/utils";

interface PriceAlertsSettingsProps {
  onBack: () => void;
}

export function PriceAlertsSettings({ onBack }: PriceAlertsSettingsProps) {
  const { config, updateConfig } = useAlertConfig();

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h3 className="font-semibold text-sm">Alert Settings</h3>
          <p className="text-[10px] text-muted-foreground">
            Configure your price alerts
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Notification Toggles */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Notifications
          </p>

          {/* Sound Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center",
                  config.soundEnabled
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {config.soundEnabled ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
              </div>
              <div>
                <Label htmlFor="sound" className="text-sm font-medium">
                  Sound alerts
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Play sound on new alerts
                </p>
              </div>
            </div>
            <Switch
              id="sound"
              checked={config.soundEnabled}
              onCheckedChange={(checked) =>
                updateConfig({ soundEnabled: checked })
              }
            />
          </div>

          {/* Browser Notifications Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center",
                  config.browserNotificationsEnabled
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <Label htmlFor="browser-notif" className="text-sm font-medium">
                  Browser notifications
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Show desktop notifications
                </p>
              </div>
            </div>
            <Switch
              id="browser-notif"
              checked={config.browserNotificationsEnabled}
              onCheckedChange={(checked) =>
                updateConfig({ browserNotificationsEnabled: checked })
              }
            />
          </div>
        </div>

        {/* Thresholds */}
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Thresholds
          </p>

          {/* Dip Threshold */}
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-500" />
                <Label className="text-sm font-medium">Dip alert</Label>
              </div>
              <span className="text-sm font-bold text-red-500">
                -{(config.dipThreshold * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              value={[config.dipThreshold * 100]}
              onValueChange={([value]) =>
                updateConfig({ dipThreshold: value / 100 })
              }
              min={1}
              max={30}
              step={1}
              className="w-full"
            />
            <p className="text-[10px] text-muted-foreground mt-2">
              Alert when price drops by this % in 5 seconds
            </p>
          </div>

          {/* Spike Threshold */}
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <Label className="text-sm font-medium">Spike alert</Label>
              </div>
              <span className="text-sm font-bold text-emerald-500">
                +{(config.spikeThreshold * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              value={[config.spikeThreshold * 100]}
              onValueChange={([value]) =>
                updateConfig({ spikeThreshold: value / 100 })
              }
              min={1}
              max={30}
              step={1}
              className="w-full"
            />
            <p className="text-[10px] text-muted-foreground mt-2">
              Alert when price rises by this % in 5 seconds
            </p>
          </div>

          {/* Cooldown */}
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Cooldown</Label>
              </div>
              <span className="text-sm font-bold">
                {config.alertCooldownMs / 1000}s
              </span>
            </div>
            <Slider
              value={[config.alertCooldownMs / 1000]}
              onValueChange={([value]) =>
                updateConfig({ alertCooldownMs: value * 1000 })
              }
              min={5}
              max={120}
              step={5}
              className="w-full"
            />
            <p className="text-[10px] text-muted-foreground mt-2">
              Minimum time between alerts for same market
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
