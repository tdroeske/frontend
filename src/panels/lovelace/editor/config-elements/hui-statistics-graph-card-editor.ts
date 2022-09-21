import "../../../../components/ha-form/ha-form";
import {
  css,
  CSSResultGroup,
  html,
  LitElement,
  PropertyValues,
  TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators";
import memoizeOne from "memoize-one";
import {
  array,
  assert,
  assign,
  literal,
  number,
  object,
  optional,
  string,
  union,
} from "superstruct";
import { fireEvent } from "../../../../common/dom/fire_event";
import type { LocalizeFunc } from "../../../../common/translations/localize";
import "../../../../components/entity/ha-statistics-picker";
import type { SchemaUnion } from "../../../../components/ha-form/types";
import type { HomeAssistant } from "../../../../types";
import type { StatisticsGraphCardConfig } from "../../cards/types";
import { processConfigEntities } from "../../common/process-config-entities";
import type { LovelaceCardEditor } from "../../types";
import { baseLovelaceCardConfig } from "../structs/base-card-struct";
import { entitiesConfigStruct } from "../structs/entities-struct";
import {
  getStatisticMetadata,
  StatisticsMetaData,
  statisticsMetaHasType,
} from "../../../../data/recorder";
import { deepEqual } from "../../../../common/util/deep-equal";
import { statTypeMap } from "../../../../components/chart/statistics-chart";

const statTypeStruct = union([
  literal("state"),
  literal("sum"),
  literal("min"),
  literal("max"),
  literal("mean"),
]);

const cardConfigStruct = assign(
  baseLovelaceCardConfig,
  object({
    entities: array(entitiesConfigStruct),
    title: optional(string()),
    days_to_show: optional(number()),
    period: optional(
      union([
        literal("5minute"),
        literal("hour"),
        literal("day"),
        literal("month"),
      ])
    ),
    chart_type: optional(union([literal("bar"), literal("line")])),
    stat_types: optional(union([array(statTypeStruct), statTypeStruct])),
  })
);

const periods = ["5minute", "hour", "day", "month"] as const;
const stat_types = ["mean", "min", "max", "sum", "state"] as const;

@customElement("hui-statistics-graph-card-editor")
export class HuiStatisticsGraphCardEditor
  extends LitElement
  implements LovelaceCardEditor
{
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: StatisticsGraphCardConfig;

  @state() private _configEntities?: string[];

  @state() private _metaDatas?: StatisticsMetaData[];

  public setConfig(config: StatisticsGraphCardConfig): void {
    assert(config, cardConfigStruct);
    this._config = config;
    this._configEntities = config.entities
      ? processConfigEntities(config.entities, false).map((cfg) => cfg.entity)
      : [];
  }

  private _getStatisticsMetaData = async (statisticIds?: string[]) => {
    this._metaDatas = await getStatisticMetadata(
      this.hass!,
      statisticIds || []
    );
    if (statisticIds?.some((statistic_id) => statistic_id.includes(":"))) {
      const { period, ...config } = this._config!;
      fireEvent(this, "config-changed", {
        config: config,
      });
    }
  };

  public willUpdate(changedProps: PropertyValues) {
    if (
      changedProps.has("_configEntities") &&
      !deepEqual(this._configEntities, changedProps.get("_configEntities"))
    ) {
      this._metaDatas = undefined;
      this._getStatisticsMetaData(this._configEntities);
    }
  }

  private _schema = memoizeOne(
    (
      localize: LocalizeFunc,
      statisticIds: string[] | undefined,
      metaDatas: StatisticsMetaData[] | undefined
    ) =>
      [
        { name: "title", selector: { text: {} } },
        {
          name: "",
          type: "grid",
          schema: [
            {
              name: "period",
              required: true,
              selector: {
                select: {
                  options: periods.map((period) => ({
                    value: period,
                    label: localize(
                      `ui.panel.lovelace.editor.card.statistics-graph.periods.${period}`
                    ),
                    disabled:
                      period === "5minute" &&
                      // External statistics don't support 5-minute statistics.
                      // External statistics is formatted as <domain>:<object_id>
                      statisticIds?.some((statistic_id) =>
                        statistic_id.includes(":")
                      ),
                  })),
                },
              },
            },
            {
              name: "days_to_show",
              required: true,
              selector: { number: { min: 1, mode: "box" } },
            },
            {
              name: "stat_types",
              required: true,
              selector: {
                select: {
                  multiple: true,
                  options: stat_types.map((stat_type) => ({
                    value: stat_type,
                    label: localize(
                      `ui.panel.lovelace.editor.card.statistics-graph.stat_type_labels.${stat_type}`
                    ),
                    disabled:
                      !metaDatas ||
                      !metaDatas?.every((metaData) =>
                        statisticsMetaHasType(metaData, statTypeMap[stat_type])
                      ),
                  })),
                },
              },
            },
            {
              name: "chart_type",
              required: true,
              type: "select",
              options: [
                ["line", "Line"],
                ["bar", "Bar"],
              ],
            },
          ],
        },
      ] as const
  );

  protected render(): TemplateResult {
    if (!this.hass || !this._config) {
      return html``;
    }

    const schema = this._schema(
      this.hass.localize,
      this._configEntities,
      this._metaDatas
    );
    const configured_stat_types = this._config!.stat_types
      ? Array.isArray(this._config!.stat_types)
        ? this._config!.stat_types
        : [this._config!.stat_types]
      : stat_types;
    const data = {
      chart_type: "line",
      period: "hour",
      days_to_show: 30,
      ...this._config,
      stat_types: configured_stat_types,
    };
    const displayUnit = this._metaDatas?.[0]?.display_unit_of_measurement;

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${schema}
        .computeLabel=${this._computeLabelCallback}
        @value-changed=${this._valueChanged}
      ></ha-form>
        <ha-statistics-picker
          .hass=${this.hass}
          .pickStatisticLabel=${this.hass!.localize(
            "ui.panel.lovelace.editor.card.statistics-graph.pick_statistic"
          )}
          .pickedStatisticLabel=${this.hass!.localize(
            "ui.panel.lovelace.editor.card.statistics-graph.picked_statistic"
          )}
          .includeDisplayUnitOfMeasurement=${displayUnit}
          .ignoreRestrictionsOnFirstStatistic=${true}
          .value=${this._configEntities}
          .configValue=${"entities"}
          @value-changed=${this._entitiesChanged}
        ></ha-statistics-picker>
      </div>
    `;
  }

  private _valueChanged(ev: CustomEvent): void {
    fireEvent(this, "config-changed", { config: ev.detail.value });
  }

  private _entitiesChanged(ev: CustomEvent): void {
    fireEvent(this, "config-changed", {
      config: { ...this._config!, entities: ev.detail.value },
    });
  }

  private _computeLabelCallback = (
    schema: SchemaUnion<ReturnType<typeof this._schema>>
  ) => {
    switch (schema.name) {
      case "chart_type":
      case "stat_types":
      case "period":
        return this.hass!.localize(
          `ui.panel.lovelace.editor.card.statistics-graph.${schema.name}`
        );
      default:
        return this.hass!.localize(
          `ui.panel.lovelace.editor.card.generic.${schema.name}`
        );
    }
  };

  static styles: CSSResultGroup = css`
    ha-statistics-picker {
      width: 100%;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "hui-statistics-graph-card-editor": HuiStatisticsGraphCardEditor;
  }
}
