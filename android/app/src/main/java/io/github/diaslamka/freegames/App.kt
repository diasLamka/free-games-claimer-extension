package io.github.diaslamka.freegames

import android.app.Application
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.notify.Notifier
import io.github.diaslamka.freegames.work.Scheduler

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Graph.init(this)
        Notifier.createChannels(this)
        Scheduler.periodic(this, Graph.store.value.settings.checkHours)
    }
}
