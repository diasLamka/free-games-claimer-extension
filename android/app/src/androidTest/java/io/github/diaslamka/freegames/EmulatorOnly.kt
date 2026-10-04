package io.github.diaslamka.freegames

import android.Manifest
import android.os.Build
import androidx.test.rule.GrantPermissionRule
import org.junit.Assume
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement

/**
 * Ces tests ecrivent dans l'etat de l'appli, postent ses notifications et lancent son travail de fond : ils ne tournent que
 * sur un emulateur. (Gradle installe aussi l'appli avant les tests : ne le lance jamais avec un vrai telephone branche sans
 * ANDROID_SERIAL -- android/tools/emulator.ps1 le fait.)
 */
class EmulatorOnly : TestRule {
    override fun apply(base: Statement, description: Description): Statement = object : Statement() {
        override fun evaluate() {
            Assume.assumeTrue("emulateur seulement", isEmulator)
            base.evaluate()
        }
    }

    companion object {
        /** La permission de notifications (Android 13 et plus) : avant, elle n'existe pas et l'accorder leve une exception. */
        fun grantNotifications(): GrantPermissionRule =
            if (Build.VERSION.SDK_INT >= 33) GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS) else GrantPermissionRule.grant()

        val isEmulator: Boolean
            get() = Build.HARDWARE.let { it.contains("ranchu") || it.contains("goldfish") } ||
                Build.FINGERPRINT.startsWith("generic") || Build.MODEL.contains("sdk_gphone") || Build.PRODUCT.contains("sdk")
    }
}
