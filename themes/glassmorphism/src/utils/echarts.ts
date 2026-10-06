/**
 * ECharts 共享注册。
 *
 * 与 Komari `utils/echarts.ts` 一致：只注册实际用到的图表与组件，
 * 走 tree-shaking 入口而不是整包引入，注册一次供所有图表组件复用。
 */
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  CanvasRenderer,
])
