import Vue from 'vue'
import { MainProcess } from './main-process-bindings'
import { Config as ConfigType } from '@/shared/types'
import { PUSH_CONFIG } from '@/shared/ipc-event'

class ConfigService {
  store: ConfigType

  constructor () {
    this.store = Vue.observable(MainProcess.getConfig())

    MainProcess.addEventListener(PUSH_CONFIG, (e) => {
      const config = (e as CustomEvent<ConfigType>).detail
      for (const key in config) {
        Vue.set(this.store, key, config[key as keyof ConfigType])
      }
    })
  }
}

export const Config = new ConfigService()
