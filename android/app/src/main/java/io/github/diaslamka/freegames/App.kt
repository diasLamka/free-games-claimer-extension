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
        // La sauvegarde automatique, si elle est activee : le travail periodique survit, on le repose au cas ou.
        if (Graph.store.value.settings.backupFolder != null) Scheduler.backup(this, true)
    }
}
