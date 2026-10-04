package io.github.diaslamka.freegames

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Parcel
import android.os.Parcelable
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Un parcelable ordinaire : le test change son nom dans les octets, pour que ce processus ne puisse plus le relire. */
class Unreadable() : Parcelable {
    override fun describeContents() = 0
    override fun writeToParcel(p: Parcel, flags: Int) = p.writeInt(1)

    companion object {
        @JvmField
        val CREATOR = object : Parcelable.Creator<Unreadable> {
            override fun createFromParcel(p: Parcel) = Unreadable().also { p.readInt() }
            override fun newArray(n: Int) = arrayOfNulls<Unreadable>(n)
        }
    }
}

/**
 * L'activite exportee face a un intent qu'elle ne sait pas lire. Volontairement SANS banc de test Compose : celui-ci installe son
 * propre moteur de recomposition, qui capture l'exception d'un effet au lieu de planter. Ici, c'est le moteur de production :
 * l'exception tue le processus, comme chez un vrai utilisateur.
 *
 * Android 12 et avant : lire n'importe quel extra d'un paquet illisible leve BadParcelableException (meme une cle absente).
 * Android 13 et apres : le systeme neutralise lui-meme ce cas, et le test passe avec ou sans la protection de `Incoming`.
 */
@RunWith(AndroidJUnit4::class)
class ExportedActivityDeviceTest {
    @get:Rule val emulatorOnly = EmulatorOnly()
    @get:Rule val permission: GrantPermissionRule = EmulatorOnly.grantNotifications()

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun anIntentWhoseExtrasCannotBeReadDoesNotCrashTheApp() {
        val bundle = Bundle().apply { putParcelable(MainActivity.EXTRA_CLAIM, Unreadable()) }
        val parcel = Parcel.obtain()
        parcel.writeBundle(bundle)
        val raw = parcel.marshall()
        parcel.recycle()
        // Meme longueur, nom de classe qui n'existe pas : lire l'extra leve BadParcelableException (ClassNotFound).
        val name = Unreadable::class.java.name
        val from = name.toByteArray(Charsets.UTF_16LE)
        val to = (name.dropLast(1) + "X").toByteArray(Charsets.UTF_16LE)
        val at = (0..raw.size - from.size).firstOrNull { i -> from.indices.all { raw[i + it] == from[it] } }
        assertNotNull("le nom de la classe est dans le paquet", at)
        System.arraycopy(to, 0, raw, at!!, to.size)
        val reader = Parcel.obtain()
        reader.unmarshall(raw, 0, raw.size)
        reader.setDataPosition(0)
        val hostile = reader.readBundle(context.classLoader)
        reader.recycle()

        val monitor = InstrumentationRegistry.getInstrumentation().addMonitor(MainActivity::class.java.name, null, false)
        context.startActivity(Intent(context, MainActivity::class.java).replaceExtras(hostile).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val activity = monitor.waitForActivityWithTimeout(20_000)
        assertNotNull("l'activite s'est ouverte", activity)
        // Le temps que l'ecran lise l'intent (un effet Compose, juste apres le premier affichage) : sans la protection, le
        // processus de l'appli -- et donc ce test -- meurt ici sur Android 12 et avant.
        Thread.sleep(5_000)
        assertFalse("l'activite est toujours la", activity.isFinishing || activity.isDestroyed)
        activity.finish()
    }
}
