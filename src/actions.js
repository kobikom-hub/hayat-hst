const { fetchAndSolveCaptcha } = require('./captchaSolver');
const {
  hospitalRequest,
  selectHospital,
  setVariables
} = require('./hospitalClient');
const {
  normalizeStructuredData,
  parseAppointmentApprove,
  parseAppointmentCode,
  parseAppointmentTimeResponse
} = require('./parsers');

const HOSPITALS = {
  2: 'Hayat Hastahanesi',
  4: 'Aktif Yasam Tip Merkezi',
  5: 'Urotas Hayat Tip Merkezi',
  6: 'Pendik Sifa Hastahanesi'
};

function requireField(body, fieldName) {
  if (body[fieldName] === undefined || body[fieldName] === null || body[fieldName] === '') {
    throw new Error(`Missing ${fieldName}`);
  }

  return body[fieldName];
}

function asTenDigitPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.length !== 10) {
    throw new Error('phone must be 10 digits');
  }

  return digits;
}

function normalizeGender(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized === 'ERKEK' || normalized === 'E') {
    return 'E';
  }

  if (normalized === 'KADIN' || normalized === 'K') {
    return 'K';
  }

  return normalized;
}

function formBody(payload) {
  return new URLSearchParams(
    Object.entries(payload)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  ).toString();
}

function buildPatientPayload(body) {
  const gender = normalizeGender(requireField(body, 'gender'));
  const phone = asTenDigitPhone(requireField(body, 'phone'));

  return {
    identity_no: requireField(body, 'identity_no'),
    name: requireField(body, 'name'),
    surname: requireField(body, 'surname'),
    gender,
    birth_date: requireField(body, 'birth_date'),
    father_name: requireField(body, 'father_name'),
    mother_name: requireField(body, 'mother_name'),
    phone,
    city_id: requireField(body, 'city_id'),
    county_id: body.county_id,
    association_id: requireField(body, 'association_id'),
    fr_identity_no: requireField(body, 'identity_no'),
    fr_name: requireField(body, 'name'),
    fr_surname: requireField(body, 'surname'),
    fr_gender: gender,
    fr_birth_date: requireField(body, 'birth_date'),
    fr_father_name: requireField(body, 'father_name'),
    fr_mother_name: requireField(body, 'mother_name'),
    fr_phone: phone,
    fr_city_id: requireField(body, 'city_id'),
    fr_county_id: body.county_id,
    fr_association_id: requireField(body, 'association_id')
  };
}

async function getPatientInfoWithCaptcha(session, config, body) {
  const identityNo = requireField(body, 'identity_no');
  const fatherName = requireField(body, 'father_name');
  const birthDate = requireField(body, 'birth_date');

  let lastResponse = null;

  for (let attempt = 1; attempt <= config.captchaMaxAttempts; attempt += 1) {
    const captcha = await fetchAndSolveCaptcha(session, hospitalRequest, config.baseUrl);
    const response = await hospitalRequest(session, {
      baseUrl: config.baseUrl,
      path: '/get_patient_info.php',
      query: {
        hd_patient_type: 1,
        fr_identity_no: identityNo,
        fr_father_name: fatherName,
        fr_birth_date: birthDate,
        fr_secure_code: captcha.text
      }
    });

    const normalized = normalizeStructuredData(response.data);
    lastResponse = normalized;

    if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
      if (Number(normalized.secure_pass) === 0) {
        continue;
      }

      return normalized;
    }

    if (typeof normalized === 'string' && /secure_pass["'=:\s]+0/i.test(normalized)) {
      continue;
    }

    return normalized;
  }

  throw new Error(`Captcha validation failed after ${config.captchaMaxAttempts} attempts: ${JSON.stringify(lastResponse)}`);
}

function actionHandlers(config) {
  return {
    async get_departments(session, body) {
      const hospitalId = Number(requireField(body, 'hospital_id'));

      if (!HOSPITALS[hospitalId]) {
        throw new Error('Unsupported hospital_id');
      }

      await selectHospital(session, {
        baseUrl: config.baseUrl,
        hospitalId
      });

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/get_departments.php',
        query: {
          off_id: hospitalId
        }
      });

      return {
        hospital_id: hospitalId,
        hospital_name: HOSPITALS[hospitalId],
        items: normalizeStructuredData(response.data)
      };
    },

    async get_doctors(session, body) {
      const departmentId = requireField(body, 'department_id');

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/get_doctors.php',
        query: {
          bc_id: departmentId
        }
      });

      return {
        department_id: departmentId,
        items: normalizeStructuredData(response.data)
      };
    },

    async get_days(session) {
      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/get_days.php'
      });

      return {
        items: normalizeStructuredData(response.data)
      };
    },

    async get_appointment_time(session, body) {
      const doctorId = requireField(body, 'doctor_id');
      const deptId = requireField(body, 'dept_id');
      const day = requireField(body, 'day');

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/get_appointment_time.php',
        query: {
          dr_id: doctorId,
          dept_id: deptId,
          day
        }
      });

      return {
        doctor_id: doctorId,
        dept_id: deptId,
        day,
        items: parseAppointmentTimeResponse(response.data)
      };
    },

    async set_appointment_time(session, body) {
      const aopId = requireField(body, 'aop_id');
      const appType = requireField(body, 'app_type');

      const response = await setVariables(session, {
        baseUrl: config.baseUrl,
        vars: 'aop_id|app_type',
        vals: `${aopId}|${appType}`
      });

      return {
        aop_id: Number(aopId),
        app_type: Number(appType),
        result: normalizeStructuredData(response.data)
      };
    },

    async get_patient_info(session, body) {
      const result = await getPatientInfoWithCaptcha(session, config, body);

      return {
        identity_no: body.identity_no,
        result
      };
    },

    async create_patient(session, body) {
      const payload = buildPatientPayload(body);

      const response = await hospitalRequest(session, {
        method: 'POST',
        baseUrl: config.baseUrl,
        path: '/insert_patient.php',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: formBody(payload)
      });

      return {
        identity_no: payload.identity_no,
        result: normalizeStructuredData(response.data)
      };
    },

    async get_counties(session, body) {
      const cityId = requireField(body, 'city_id');

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/county_list.php',
        query: {
          city_id: cityId
        }
      });

      return {
        city_id: Number(cityId),
        items: normalizeStructuredData(response.data)
      };
    },

    async send_sms(session, body) {
      const pnId = requireField(body, 'pn_id');

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/send_sms.php',
        query: {
          pn_id: pnId
        }
      });

      return {
        pn_id: Number(pnId),
        result: normalizeStructuredData(response.data)
      };
    },

    async check_verification_code(session, body) {
      const verificationCode = requireField(body, 'verification_code');

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/check_verification_code.php',
        query: {
          fr_verification_code: verificationCode
        }
      });

      return {
        verification_code: verificationCode,
        result: normalizeStructuredData(response.data)
      };
    },

    async get_appointment_approve(session) {
      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/appointment_approve.php'
      });

      return parseAppointmentApprove(response.data);
    },

    async approve_appointment(session) {
      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/insert_appointment.php'
      });

      return parseAppointmentCode(response.data);
    }
  };
}

async function runAction(action, session, body, config) {
  const handlers = actionHandlers(config);
  const handler = handlers[action];

  if (!handler) {
    throw new Error('Unknown action');
  }

  return handler(session, body);
}

module.exports = {
  HOSPITALS,
  runAction
};
